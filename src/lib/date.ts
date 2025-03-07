export function constructDateFromSplits(date: string, time: string) {
  const baseDate = new Date(date)
  if (time.length) {
    const splits = time.split(':')
    if (!splits.length) {
      return baseDate
    }
    const [hours, minutes, seconds] = splits
    if (hours) baseDate.setHours(Number(hours))
    if (minutes) baseDate.setMinutes(Number(minutes))
    if (seconds) baseDate.setSeconds(Number(seconds))
  }
  return baseDate
}
