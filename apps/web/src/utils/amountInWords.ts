const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

function integerInWords(n: number): string {
  if (n === 0) return "Zero";
  const scales: Array<[number, string]> = [
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
  ];
  const parts: string[] = [];
  for (const [size, name] of scales) {
    if (n >= size) {
      parts.push(`${below1000(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(below1000(n));
  return parts.join(" ");
}

const CURRENCY_NAMES: Record<string, [string, string]> = {
  SAR: ["Saudi Riyals", "Halalas"],
  PKR: ["Pakistani Rupees", "Paisas"],
  USD: ["US Dollars", "Cents"],
  AED: ["UAE Dirhams", "Fils"],
  EUR: ["Euros", "Cents"],
};

/** "1,250.50" → "One Thousand Two Hundred Fifty Saudi Riyals and Fifty Halalas Only" */
export function amountInWords(amount: number, currencyCode?: string | null): string {
  const [major, minor] = (currencyCode && CURRENCY_NAMES[currencyCode]) || [currencyCode ?? "", "Hundredths"];
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  let text = `${integerInWords(whole)}${major ? ` ${major}` : ""}`;
  if (fraction > 0) text += ` and ${integerInWords(fraction)} ${fraction === 1 && minor.endsWith("s") ? minor.slice(0, -1) : minor}`;
  return `${text} Only`;
}
