import { z } from 'zod';

export const UpdateMenuSchema = z.object({
  title: z
    .string()
    .min(1, { message: 'Title is required and cannot be empty' })
    .trim()
    .optional(), // Make title optional for update
  aco_id: z.number().int({ message: 'aco_id must be an integer' }).optional(),
  icon: z.string().nullable().optional(), // Optional
  isActive: z.number().optional(), // Optional
  parentId: z
    .number()
    .int({ message: 'parentId must be an integer' })
    .nonnegative({ message: 'parentId must be a non-negative integer' })
    .optional(), // Optional
  statusaktif: z.string()
    .min(0, { message: 'statusaktif must be a non-negative integer' })
    .optional(), // Optional
  order: z.number().nullable().optional(), // Optional
  modifiedby: z.string().nullable().optional(), // Optional, you might pass the current user here
});
export type UpdateMenuDto = z.infer<typeof UpdateMenuSchema>;
