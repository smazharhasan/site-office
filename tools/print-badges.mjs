// Prints QR site passes (A4, 10 per page) for every active person on a project.
// Usage:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node tools/print-badges.mjs <project_id> passes.pdf
// Needs: npm i @supabase/supabase-js jspdf qrcode-generator  (run from this folder)
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import qrcode from "qrcode-generator";

const [projectId, out = "passes.pdf"] = process.argv.slice(2);
if (!projectId) { console.error("Give the project id"); process.exit(1); }
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: project } = await db.from("projects").select("name, address").eq("id", projectId).single();
const { data: people, error } = await db.from("people").select("id, full_name, type, trade, gang, cnic, btk_card_no, btk_card_expiry, badge_token").eq("project_id", projectId).eq("status", "active").order("full_name");
if (error) throw error;

const doc = new jsPDF({ unit: "mm", format: "a4" }); const W = 86, H = 54;
people.forEach((p, i) => {
  const k = i % 10; if (i && !k) doc.addPage();
  const x = 14 + (k % 2) * (W + 10), y = 10 + Math.floor(k / 2) * (H + 2);
  doc.setDrawColor(200); doc.roundedRect(x, y, W, H, 3, 3);
  doc.setFillColor(15, 111, 92); doc.rect(x, y, W, 9, "F"); doc.setTextColor(255); doc.setFontSize(8.5);
  doc.text(`${project.name.toUpperCase()} · SITE PASS`, x + 3, y + 6);
  doc.setTextColor(25); doc.setFontSize(10); doc.text(p.full_name.slice(0, 28), x + 3, y + 15);
  doc.setFontSize(7.8);
  [[p.trade || p.type], ["Gang: " + (p.gang || "—")], ["BTK card: " + (p.btk_card_no || "—")], ["Valid to: " + (p.btk_card_expiry || "—")], ["CNIC: " + p.cnic.replace(/^(\d{5})-\d{7}-(\d)$/, "$1-*******-$2")]]
    .forEach(([s], j) => doc.text(String(s), x + 3, y + 21 + j * 3.8));
  const q = qrcode(0, "M"); q.addData(`SOP1|${projectId}|${p.badge_token}`); q.make();
  const n = q.getModuleCount(), size = 26, cell = size / n, qx = x + W - size - 3, qy = y + 13;
  doc.setFillColor(0);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) doc.rect(qx + c * cell, qy + r * cell, cell, cell, "F");
  doc.setFontSize(6.5); doc.setTextColor(110); doc.text("Scan at the gate · must be worn on site · report a lost pass at once", x + 3, y + H - 3);
});
writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
console.log(`${people.length} passes → ${out}`);
