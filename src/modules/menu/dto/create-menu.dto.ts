import { z } from 'zod';

export const CreateMenuSchema = z.object({
  title: z
    .string()
    .min(1, { message: 'Title is required and cannot be empty' })
    .trim(), // Ensure there's no extra whitespace
  aco_id: z.number().int({ message: 'aco_id must be an integer' }).optional(),
  icon: z.string().nullable().optional(),
  isActive: z.number(),
  parentId: z
    .number()
    .int({ message: 'parentId must be an integer' })
    .optional(),
  // .nonnegative({ message: 'parentId must be a non-negative integer' }), // Ensure it’s non-negative
  statusaktif: z.string()
    .min(0, { message: 'statusaktif must be a non-negative integer' }), // Additional check for non-negative
  order: z.number().nullable().optional(),
  modifiedby: z.string().nullable().optional(),
});
export type CreateMenuDto = z.infer<typeof CreateMenuSchema>;
