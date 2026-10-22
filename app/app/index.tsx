import { Redirect } from "expo-router";
import Constants from "expo-constants";

/** "Mimaar ERP" opens the ERPNext site; "Mimaar" opens the current app as before. */
const ERP = (Constants.expoConfig?.extra as { variant?: string } | undefined)?.variant === "erp";

export default function Start() {
  return <Redirect href={ERP ? "/erp" : "/home"} />;
}
