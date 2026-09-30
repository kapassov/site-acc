/** All storefront orders follow the Kazakhstan opening window, regardless of server timezone. */
const ORDER_TIME_ZONE = "Asia/Almaty";
const OPENS_AT_MINUTE = 9 * 60;
// Stop checkout 30 minutes before the pharmacy closes at 21:00.
const LAST_ORDER_MINUTE = 20 * 60 + 30;

export function ordersAcceptingNow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ORDER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
  const minuteOfDay = hour * 60 + minute;
  return minuteOfDay >= OPENS_AT_MINUTE && minuteOfDay < LAST_ORDER_MINUTE;
}
