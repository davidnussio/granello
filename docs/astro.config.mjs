// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// The documentation of Granello, at granello.dambox.ch. English at the root, Italian under /it/.
// The screenshots in src/assets/shots come from `pnpm screenshots` in the app (demo data only).
export default defineConfig({
  site: "https://granello.dambox.ch",
  integrations: [
    starlight({
      title: "Granello",
      description:
        "Meeting notes for macOS that stay on your Mac: local transcription, AI notes, a privacy level per meeting.",
      logo: { src: "./src/assets/logo.png" },
      favicon: "/favicon.png",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/davidnussio/granello" }],
      editLink: { baseUrl: "https://github.com/davidnussio/granello/edit/main/docs/" },
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        it: { label: "Italiano", lang: "it" },
      },
      customCss: ["./src/styles/custom.css"],
      components: { SocialIcons: "./src/components/SocialIcons.astro" },
      sidebar: [
        {
          label: "Start",
          translations: { it: "Per cominciare" },
          items: [{ slug: "start/install" }, { slug: "start/first-meeting" }],
        },
        {
          label: "Privacy",
          items: [
            { slug: "privacy/overview" },
            { slug: "privacy/levels" },
            { slug: "privacy/redaction" },
            { slug: "privacy/local-models" },
          ],
        },
        {
          label: "Guides",
          translations: { it: "Guide" },
          items: [
            { slug: "guides/recording" },
            { slug: "guides/notes" },
            { slug: "guides/ai-notes" },
            { slug: "guides/library" },
            { slug: "guides/people" },
          ],
        },
        {
          label: "Reference",
          translations: { it: "Riferimenti" },
          items: [
            { slug: "reference/slash-commands" },
            { slug: "reference/shortcuts" },
            { slug: "reference/data" },
            { slug: "reference/troubleshooting" },
          ],
        },
      ],
    }),
  ],
});
