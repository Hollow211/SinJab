import { getServerAuthSession } from "@quenti/auth";
import { stripe } from "@quenti/payments";
import { orgMetadataSchema } from "@quenti/prisma/zod-schemas";
import { conflictingDomain } from "@quenti/trpc/server/lib/orgs/domains";
import { bulkJoinOrgStudents } from "@quenti/trpc/server/lib/orgs/students";
import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { z } from "zod";
import { prisma } from "../../../../../../../packages/prisma";

const querySchema = z.object({
  id: z.string().cuid2(),
  session_id: z.string().min(1),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id, session_id } = querySchema.parse(req.query);

  const checkoutSession = await stripe.checkout.sessions.retrieve(session_id, {
    expand: ["subscription"],
  });
  if (!checkoutSession.subscription)
    return res.status(404).json({ error: "Checkout session not found" });

  const subscription = checkoutSession.subscription as Stripe.Subscription;
  if (checkoutSession.payment_status !== "paid")
    return res.status(402).json({ error: "Payment required" });

  let org = await prisma.organization.findFirst({
    where: { metadata: { path: "$.paymentId", equals: session_id } },
  });

  if (!org) {
    const prevOrg = await prisma.organization.findFirstOrThrow({
      where: { id },
      include: { domain: true },
    });
    const metadata = orgMetadataSchema.parse(prevOrg.metadata);

    const conflicting =
      !!prevOrg.domain &&
      !!(await conflictingDomain(id, prevOrg.domain.requestedDomain));

    org = await prisma.organization.update({
      where: { id },
      data: {
        metadata: {
          ...metadata,
          paymentId: checkoutSession.id,
          subscriptionId: subscription.id || null,
          subscriptionItemId: subscription.items.data[0]?.id || null,
        },
        published: true,
        domain:
          prevOrg.domain && !conflicting
            ? {
                update: {
                  domain: prevOrg.domain.requestedDomain,
                },
              }
            : undefined,
      },
    });

    if (prevOrg.domain)
      await bulkJoinOrgStudents(org.id, prevOrg.domain.requestedDomain);
  }

  const session = await getServerAuthSession({ req, res });
  if (!session) return { message: "Upgraded successfully" };

  res.redirect(302, `/orgs/${org.id}?upgrade=success`);
}
