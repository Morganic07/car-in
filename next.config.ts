import type { NextConfig } from 'next'

const configuration: NextConfig = {
  // Empêche `next dev` d'écrire des consignes d'outillage dans les fichiers de
  // configuration locale à chaque lancement. La documentation de cette version de
  // Next reste lisible dans node_modules/next/dist/docs/.
  agentRules: false,
}

export default configuration
