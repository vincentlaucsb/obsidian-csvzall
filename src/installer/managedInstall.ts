import type { CsvzallReleaseInfo } from "../installer.js";
import type { CsvzallPluginSettings } from "../settings/settings.js";

export function isManagedCsvzallCurrent(
  settings: Pick<CsvzallPluginSettings, "installedCsvzallVersion" | "installedCsvzallAssetName">,
  latest: CsvzallReleaseInfo,
): boolean {
  return settings.installedCsvzallVersion.length > 0 &&
    settings.installedCsvzallVersion === latest.tagName &&
    settings.installedCsvzallAssetName.length > 0 &&
    settings.installedCsvzallAssetName === latest.assetName;
}
