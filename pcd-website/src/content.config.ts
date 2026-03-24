import { defineCollection, z } from 'astro:content';

const events = defineCollection({
  type: 'content',
  schema: z.object({
    id: z.string(),
    uid: z.string().regex(/^[0-9a-f]{7}$/),
  }).passthrough(),
});

export const collections = {
  events,
};
