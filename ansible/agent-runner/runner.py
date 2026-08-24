#!/usr/bin/env python3
"""Minimal agent runner: call an OpenAI-compatible MaaS and write a draft.

Used as the OpenShift Job payload created by ansible/provision-agent.yml.
If MAAS_BASE_URL is unset, writes a labeled simulated draft so the Job still
completes in a disconnected eval cluster.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def simulated_draft(listing: str, goal: str) -> str:
    return (
        f"Draft from {listing}\n\n"
        f"Goal: {goal or '(none provided)'}\n\n"
        "This Job ran without a MaaS URL, so the runner wrote a placeholder "
        "draft. Configure MAAS_BASE_URL on the AAP job template to call a "
        "real model.\n\n— Not sent. Approve in AgentStore to accept."
    )


def call_maas(base: str, model: str, listing: str, goal: str, criteria: str) -> str:
    url = base.rstrip("/") + "/chat/completions"
    prompt = f"You are the '{listing}' agent. Produce a concise draft the requester can approve.\nGoal: {goal}"
    if criteria:
        prompt += f"\nSuccess criteria: {criteria}"
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
        }
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    token = env("MAAS_API_KEY")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=120) as resp:
        payload = json.loads(resp.read().decode())
    return payload["choices"][0]["message"]["content"]


def main() -> int:
    listing = env("LISTING_NAME", "agent")
    goal = env("GOAL")
    criteria = env("SUCCESS_CRITERIA")
    result_file = env("RESULT_FILE", "/output/draft.txt")
    base = env("MAAS_BASE_URL")
    model = env("MAAS_MODEL", "default")

    try:
        if base:
            text = call_maas(base, model, listing, goal, criteria)
        else:
            text = simulated_draft(listing, goal)
    except (urllib.error.URLError, KeyError, TimeoutError, json.JSONDecodeError) as err:
        text = simulated_draft(listing, goal) + f"\n\n(MaaS call failed: {err})"

    os.makedirs(os.path.dirname(result_file) or ".", exist_ok=True)
    with open(result_file, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
