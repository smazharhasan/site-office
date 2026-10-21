import { Redirect } from "expo-router";

/** Mimaar now runs on ERPNext: the app opens the project's ERPNext site. */
export default function Start() {
  return <Redirect href="/erp" />;
}
