import next from 'eslint-config-next'

const configuration = [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
]

export default configuration
