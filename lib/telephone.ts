/// `tel:` sans espaces ni points : certains téléphones refusent de composer sinon.
export function lienTelephone(telephone: string): string {
  return `tel:${telephone.replace(/[\s.-]/g, '')}`
}
