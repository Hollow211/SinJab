import type { PrismaClient, StudiableTerm, Term } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import slugify from "slugify";
import { z } from "zod";
import { USERNAME_REGEXP } from "../../../constants/characters";
import { MAX_DESC, MAX_TITLE } from "../common/constants";
import { shortId } from "../common/generator";
import { profanity } from "../common/profanity";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const getRecentFolders = async (
  prisma: PrismaClient,
  userId: string
) => {
  const recentContainers = await prisma.container.findMany({
    where: {
      userId,
      type: "Folder",
    },
    orderBy: {
      viewedAt: "desc",
    },
    take: 16,
  });
  const entityIds = recentContainers.map((e) => e.entityId);

  return (
    await prisma.folder.findMany({
      where: {
        id: {
          in: entityIds,
        },
      },
      include: {
        user: true,
        _count: {
          select: {
            studySets: true,
          },
        },
      },
    })
  ).map((x) => ({
    ...x,
    viewedAt: recentContainers.find((e) => e.entityId === x.id)!.viewedAt,
    user: {
      username: x.user.username,
      image: x.user.image,
    },
  }));
};

export const foldersRouter = createTRPCRouter({
  get: protectedProcedure
    .input(
      z.object({
        username: z.string().max(40).regex(USERNAME_REGEXP),
        idOrSlug: z.string(),
        includeTerms: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: {
          username: input.username,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      const folder = await ctx.prisma.folder.findFirst({
        where: {
          OR: [
            {
              userId: user.id,
              id: input.idOrSlug,
            },
            {
              userId: user.id,
              slug: input.idOrSlug,
            },
          ],
        },
        include: {
          studySets: {
            include: {
              studySet: {
                select: {
                  id: true,
                  title: true,
                  user: true,
                  visibility: true,
                  _count: {
                    select: {
                      terms: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      const isMyFolder = folder.userId === ctx.session.user.id;
      const studySets = folder.studySets.map((s) => s.studySet);
      const studySetsICanSee = studySets.filter((s) => {
        if (s.visibility === "Public") {
          return true;
        }
        if (s.visibility === "Unlisted") {
          // Prevent users from discovering unlisted study sets
          return s.user.id === ctx.session.user.id || isMyFolder;
        }
        if (s.visibility === "Private") {
          return s.user.id === ctx.session.user.id;
        }

        return false;
      });

      if (
        (!!studySets.length && !studySetsICanSee.length) ||
        (!studySets.length && !isMyFolder)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No study sets in this folder are visible to you",
        });
      }

      await ctx.prisma.container.upsert({
        where: {
          userId_entityId_type: {
            userId: ctx.session.user.id,
            entityId: folder.id,
            type: "Folder",
          },
        },
        create: {
          entityId: folder.id,
          userId: ctx.session.user.id,
          viewedAt: new Date(),
          type: "Folder",
        },
        update: {
          viewedAt: new Date(),
        },
      });

      const container = await ctx.prisma.container.findUnique({
        where: {
          userId_entityId_type: {
            userId: ctx.session.user.id,
            entityId: folder.id,
            type: "Folder",
          },
        },
        include: {
          studiableTerms: true,
        },
      });

      if (!container) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
        });
      }

      let terms = new Array<Term>();
      let starredTerms = new Array<string>();

      if (input.includeTerms) {
        const raw = await ctx.prisma.term.findMany({
          where: {
            studySetId: {
              in: studySetsICanSee.map((s) => s.id),
            },
          },
        });

        for (const set of studySetsICanSee) {
          terms = terms.concat(
            raw
              .filter((t) => t.studySetId === set.id)
              .sort((a, b) => a.rank - b.rank)
          );
        }
        terms = terms.map((x, i) => ({ ...x, rank: i }));

        starredTerms = (
          await ctx.prisma.starredTerm.findMany({
            where: {
              userId: ctx.session.user.id,
              termId: {
                in: terms.map((t) => t.id),
              },
            },
          })
        ).map((t) => t.termId);
      }

      if (!starredTerms.length) {
        await ctx.prisma.container.update({
          where: {
            id: container.id,
          },
          data: {
            cardsStudyStarred: false,
            matchStudyStarred: false,
          },
        });
        container.cardsStudyStarred = false;
        container.cardsStudyStarred = false;
      }

      return {
        id: folder.id,
        title: folder.title,
        description: folder.description,
        user: {
          id: user.id,
          username: user.username,
          image: user.image,
          verified: user.verified,
        },
        sets: studySetsICanSee.map((s) => ({
          ...s,
          user: {
            id: s.user.id,
            username: s.user.username,
            image: s.user.image,
            verified: s.user.verified,
          },
        })),
        container: {
          id: container.id,
          entityId: container.entityId,
          userId: container.userId,
          viewedAt: container.viewedAt,
          shuffleFlashcards: container.shuffleFlashcards,
          enableCardsSorting: container.enableCardsSorting,
          cardsRound: container.cardsRound,
          cardsStudyStarred: container.cardsStudyStarred,
          cardsAnswerWith: container.cardsAnswerWith,
          matchStudyStarred: container.matchStudyStarred,
          starredTerms,
          studiableTerms: container.studiableTerms.map((x: StudiableTerm) => ({
            id: x.termId,
            mode: x.mode,
            correctness: x.correctness,
            appearedInRound: x.appearedInRound,
            incorrectCount: x.incorrectCount,
          })),
        },
        terms,
        editableSets: studySetsICanSee
          .filter((s) => s.user.id === ctx.session.user.id)
          .map((s) => s.id),
      };
    }),

  recent: protectedProcedure.query(async ({ ctx }) => {
    return await getRecentFolders(ctx.prisma, ctx.session.user.id);
  }),

  recentForSetAdd: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const recent = await ctx.prisma.container.findMany({
        where: {
          userId: ctx.session.user.id,
          type: "Folder",
          folder: {
            userId: ctx.session.user.id,
          },
        },
        orderBy: {
          viewedAt: "desc",
        },
        take: 16,
        include: {
          folder: {
            select: {
              id: true,
              title: true,
              slug: true,
              studySets: {
                where: {
                  studySetId: input,
                },
              },
            },
          },
        },
      });

      return recent.map((r) => ({
        id: r.folder!.id,
        title: r.folder!.title,
        slug: r.folder!.slug,
        includes: r.folder!.studySets.length > 0,
      }));
    }),

  getShareId: protectedProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const folder = await ctx.prisma.folder.findUnique({
        where: {
          id: input,
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      return (
        await ctx.prisma.entityShare.upsert({
          where: {
            entityId: input,
          },
          create: {
            entityId: input,
            id: shortId() as string,
            type: "Folder",
          },
          update: {},
        })
      ).id;
    }),

  getShareIdByUsername: protectedProcedure
    .input(
      z.object({
        username: z.string(),
        idOrSlug: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: {
          username: input.username,
        },
      });

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      const folder = await ctx.prisma.folder.findFirst({
        where: {
          OR: [
            {
              userId: user.id,
              slug: input.idOrSlug,
            },
            {
              userId: user.id,
              id: input.idOrSlug,
            },
          ],
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      return (
        await ctx.prisma.entityShare.upsert({
          where: {
            entityId: folder.id,
          },
          create: {
            entityId: folder.id,
            id: shortId() as string,
            type: "Folder",
          },
          update: {},
        })
      ).id;
    }),

  create: protectedProcedure
    .input(
      z
        .object({
          title: z.string().trim().min(1),
          description: z.string(),
          setId: z.string().optional(),
        })
        .transform((z) => ({
          ...z,
          title: profanity.censor(z.title.slice(0, MAX_TITLE)),
          description: profanity.censor(z.description.slice(MAX_DESC)),
        }))
    )
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.title, { lower: true });
      const existing = await ctx.prisma.folder.findUnique({
        where: {
          userId_slug: {
            userId: ctx.session.user.id,
            slug,
          },
        },
      });

      if (input.setId) {
        const set = await ctx.prisma.studySet.findUnique({
          where: {
            id: input.setId,
          },
        });

        if (!set) {
          throw new TRPCError({
            code: "NOT_FOUND",
          });
        }
        if (
          set.visibility === "Private" &&
          set.userId !== ctx.session.user.id
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot add another user's private set to a folder",
          });
        }
      }

      return await ctx.prisma.folder.create({
        data: {
          title: input.title,
          description: input.description,
          userId: ctx.session.user.id,
          slug: !existing ? slug : null,
          studySets: input.setId
            ? {
                create: {
                  studySet: {
                    connect: {
                      id: input.setId,
                    },
                  },
                },
              }
            : {},
          containers: {
            create: {
              userId: ctx.session.user.id,
              viewedAt: new Date(),
              type: "Folder",
            },
          },
        },
      });
    }),

  edit: protectedProcedure
    .input(
      z
        .object({
          folderId: z.string(),
          title: z.string().trim().min(1),
          description: z.string(),
        })
        .transform((z) => ({
          ...z,
          title: profanity.censor(z.title.slice(0, MAX_TITLE)),
          description: profanity.censor(z.description.slice(0, MAX_DESC)),
        }))
    )
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.prisma.folder.findFirst({
        where: {
          userId: ctx.session.user.id,
          id: input.folderId,
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      const slug = slugify(input.title, { lower: true });
      const existing = await ctx.prisma.folder.findUnique({
        where: {
          userId_slug: {
            userId: ctx.session.user.id,
            slug,
          },
        },
      });

      return await ctx.prisma.folder.update({
        where: {
          id: input.folderId,
        },
        data: {
          title: input.title,
          description: input.description,
          slug: !existing ? slug : null,
        },
      });
    }),

  addSets: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        studySetIds: z.array(z.string()).max(16),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.prisma.folder.findUnique({
        where: {
          id: input.folderId,
        },
      });

      if (!folder || folder.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      const studySets = await ctx.prisma.studySet.findMany({
        where: {
          id: {
            in: input.studySetIds,
          },
        },
      });

      if (
        studySets.find(
          (x) => x.visibility == "Private" && x.userId !== ctx.session.user.id
        )
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot add other users' private study sets to a folder",
        });
      }

      await ctx.prisma.studySetsOnFolders.createMany({
        data: input.studySetIds.map((studySetId) => ({
          folderId: input.folderId,
          studySetId,
        })),
      });
    }),

  delete: protectedProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.folder.delete({
        where: {
          id_userId: {
            id: input,
            userId: ctx.session.user.id,
          },
        },
      });
    }),

  removeSet: protectedProcedure
    .input(
      z.object({
        folderId: z.string(),
        studySetId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.prisma.folder.findFirst({
        where: {
          userId: ctx.session.user.id,
          id: input.folderId,
        },
      });

      if (!folder) {
        throw new TRPCError({
          code: "NOT_FOUND",
        });
      }

      await ctx.prisma.studySetsOnFolders.delete({
        where: {
          studySetId_folderId: {
            studySetId: input.studySetId,
            folderId: input.folderId,
          },
        },
      });
    }),

  starTerm: protectedProcedure
    .input(z.object({ studySetId: z.string(), termId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const container = await ctx.prisma.container.upsert({
        where: {
          userId_entityId_type: {
            userId: ctx.session.user.id,
            entityId: input.studySetId,
            type: "StudySet",
          },
        },
        create: {
          userId: ctx.session.user.id,
          entityId: input.studySetId,
          viewedAt: new Date(),
          type: "StudySet",
        },
        update: {},
      });

      await ctx.prisma.starredTerm.create({
        data: {
          termId: input.termId,
          containerId: container.id,
          userId: ctx.session.user.id,
        },
      });
    }),
});
