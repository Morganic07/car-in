import next from 'eslint-config-next'

const configuration = [
  ...next,
  {
    // `prisma/generated/**` est du code produit par `prisma generate` : le relire
    // n'apporte rien, et une version future de Prisma pourrait y émettre quelque
    // chose qu'une règle refuse — un échec de lint qu'on ne saurait pas corriger.
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'prisma/generated/**'],
  },
]

export default configuration
