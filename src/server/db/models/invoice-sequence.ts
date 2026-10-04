import type { Collection } from "mongodb";
import { db } from "@/lib/db";

type InvoiceSequenceDocument = {
  _id: string;
  ownerId: string;
  year: number;
  seq: number;
};

function getInvoiceSequencesCollection(): Collection<InvoiceSequenceDocument> {
  return db.collection<InvoiceSequenceDocument>("invoiceSequences");
}

export async function nextInvoiceNumber(ownerId: string, issueDate = new Date()) {
  const year = issueDate.getUTCFullYear();
  const key = `${ownerId}:invoice:${year}`;

  const result = await getInvoiceSequencesCollection().findOneAndUpdate(
    { _id: key },
    {
      $inc: { seq: 1 },
      $setOnInsert: { ownerId, year },
    },
    { upsert: true, returnDocument: "after" },
  );

  const seq = result?.seq ?? 1;
  return `INV-${year}-${String(seq).padStart(6, "0")}`;
}
