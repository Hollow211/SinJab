import { z } from "zod";

export const ZCreateSchema = z.object({
  name: z.string().nonempty().max(50),
  icon: z.number().int().min(0),
});

export type TCreateSchema = z.infer<typeof ZCreateSchema>;
