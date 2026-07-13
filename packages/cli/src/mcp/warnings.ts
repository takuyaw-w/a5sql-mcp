export type WarningDetail = {
  code: string;
  [key: string]: unknown;
};

export function addWarning(
  warnings: string[],
  warningDetails: WarningDetail[],
  code: string,
  detail: Record<string, unknown> = {},
): void {
  warnings.push(code);
  warningDetails.push({ code, ...detail });
}
