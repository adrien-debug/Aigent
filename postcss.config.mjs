/**
 * Tailwind v4 se branche par un unique plugin PostCSS — pas de `tailwind.config.js`,
 * pas d'autoprefixer (la v4 l'intègre). La configuration de thème, s'il en faut une
 * un jour, vit dans le CSS lui-même (`@theme` dans src/app/globals.css).
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
