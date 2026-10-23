"use client";

import { LinkIcon } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";

interface UrlCloneProps {
  error: string | null;
  onClone: (url: string) => void;
  pending: boolean;
}

/** ONT: clone any reachable Git remote. */
export const UrlClone = ({ error, onClone, pending }: UrlCloneProps) => {
  const [url, setUrl] = useState("");
  const trimmed = url.trim();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmed) {
      onClone(trimmed);
    }
  };

  return (
    <form className="flex flex-col gap-lg" onSubmit={onSubmit}>
      <label className="flex flex-col gap-sm" htmlFor="clone-url">
        <span className="type-label text-text">Repository URL</span>
        <Input
          id="clone-url"
          leading={<LinkIcon aria-hidden="true" />}
          mono
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/owner/repo.git"
          spellCheck={false}
          value={url}
        />
        <span className="type-caption text-text-tertiary">
          Clones into the Missions repos folder (~/.missions/repos).
        </span>
      </label>
      {error ? (
        <Callout title="Could not start the clone" tone="danger">
          {error}
        </Callout>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={!trimmed || pending} type="submit" variant="primary">
          {pending ? "Starting…" : "Clone"}
        </Button>
      </div>
    </form>
  );
};
