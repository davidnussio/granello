import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema, i18nSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Starlight looks for translations of its own interface here; the files keep its defaults.
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
