/** 自动报名的执行日统一按北京时间判断。 */
export function isSignupDay(date, weekday) {
  return new Date(+date + 8 * 3600000).getUTCDay() === weekday;
}
