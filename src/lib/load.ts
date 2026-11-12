import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db";
import { getEvent } from "./services/events";

/** Load the event named in the URL, or show the 404 page. Cached per request. */
export const loadEvent = cache(async (eventIdParam: string) => {
  const id = Number(eventIdParam);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const ev = await getEvent(getDb(), id);
  if (!ev) notFound();
  return ev;
});
