/**
 * Which form of a Russian message a count takes. Message order:
 * zero | one | few | many.
 *
 * Russian needs three plural forms where English has two: "1 слот",
 * "2 слота", "5 слотов". The form follows the last digit, except for the
 * teens of every hundred, which all take the form of many: "11 слотов",
 * "113 слотов", "1 013 слотов". The teens are read off the last two digits;
 * read off the whole number, only 11 to 19 themselves are caught and 113
 * comes out as "113 слота".
 *
 * A message written with three forms has no separate one for many: the last
 * of its forms serves.
 */
export function russianPlural(choice: number, choicesLength: number): number {
  if (choice === 0) return 0;
  const lastTwo = choice % 100;
  const teen = lastTwo > 10 && lastTwo < 20;
  const lastDigit = choice % 10;
  if (!teen && lastDigit === 1) return 1;
  if (!teen && lastDigit >= 2 && lastDigit <= 4) return 2;
  return choicesLength < 4 ? 2 : 3;
}
