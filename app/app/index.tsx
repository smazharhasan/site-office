import { Redirect } from "expo-router";
import Constants from "expo-constants";

/** "Mimaar ERP" and "Mabni" open the ERPNext site; "Mimaar" opens the current app as before. */
const VARIANT = (Constants.expoConfig?.extra as { variant?: string } | undefined)?.variant;
const ERP = VARIANT === "erp" || VARIANT === "mabni";

export default function Start() {
  return <Redirect href={ERP ? "/erp" : "/home"} />;
}
