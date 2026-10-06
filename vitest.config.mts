import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // `.tsx` compris : les tests qui rendent un composant avec
    // `renderToStaticMarkup` portent du JSX, et un fichier non inclus ne s'exécute
    // pas sans que rien ne le signale.
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
