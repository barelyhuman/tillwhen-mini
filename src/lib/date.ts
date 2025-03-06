export function constructDateFromSplits(date: string, time: string) {
  const baseDate = new Date(date)
  if (time.length) {
    const splits = time.split(':')
    if (!splits.length) {
      return baseDate
    }
    const [hours, minutes, seconds] = splits
    baseDate.setHours(Number(hours), Number(minutes), Number(seconds))
  }
  return baseDate
}
