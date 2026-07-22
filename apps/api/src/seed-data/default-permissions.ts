import { PERMISSIONS } from "@erp/shared-constants";

export const DEFAULT_PERMISSIONS = Object.values(PERMISSIONS).map((key) => ({
  key,
  module: key.split(".")[0],
}));
