import { TRPCError } from "@trpc/server";
import type { DefaultContext } from "../../../lib/types";
import { shortId } from "../../common/generator";
import type { TGetShareIdSchema } from "./get-share-id.schema";

type GetShareIdOptions = {
  ctx: DefaultContext;
  input: TGetShareIdSchema;
};

export const getShareIdHandler = async ({ ctx, input }: GetShareIdOptions) => {
  const studySet = await ctx.prisma.studySet.findUnique({
    where: {
      id: input.studySetId,
    },
  });

  if (!studySet) {
    throw new TRPCError({
      code: "NOT_FOUND",
    });
  }

  if (
    studySet.visibility === "Private" &&
    studySet.userId !== ctx.session?.user?.id
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This set is private.",
    });
  }

  return (
    await ctx.prisma.entityShare.upsert({
      where: {
        entityId: input.studySetId,
      },
      create: {
        entityId: input.studySetId,
        id: shortId() as string,
        type: "StudySet",
      },
      update: {},
    })
  ).id;
};

export default getShareIdHandler;
