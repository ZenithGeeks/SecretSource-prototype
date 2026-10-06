/** "1 paper", "3 papers". */
export function count(number: number, noun: string) {
  return `${number} ${noun}${number === 1 ? '' : 's'}`
}
