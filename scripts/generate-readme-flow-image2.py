import argparse
import base64
from pathlib import Path

import httpx
from openai import OpenAI


DEFAULT_PROMPT = (
    "Create a premium horizontal system-flow graphic for an open source developer tool named FeedbackMesh. "
    "Audience: engineers, coding agents, and product teams on GitHub. "
    "Tone: refined, modern, minimal, high-end open-source infrastructure aesthetic. "
    "Use a bright editorial product-diagram style with soft slate, blue-cyan, and mint accents. "
    "Show a left-to-right flow with grouped inputs on the left labeled feedback intake, runtime signals, context layer, and agent-first install contract; "
    "a central dark FeedbackMesh case intelligence layer card in the middle; and output cards on the right labeled GitHub issue, maintainer loop, and agent execution handoff. "
    "Use crisp UI-card composition, elegant connector lines, readable English labels only, no watermark, no other brand logos, no purple bias. "
    "Make the agent-first feeling explicit through setup-session, contract, or install-path cues while keeping the diagram product-grade rather than busy. "
    "The graphic should feel like a polished launch asset from a top-tier open source infra project, not a generic infographic."
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--size", default="1536x1024")
    parser.add_argument("--timeout", type=float, default=240.0)
    parser.add_argument("--connect-timeout", type=float, default=45.0)
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    args = parser.parse_args()

    http_client = httpx.Client(
        timeout=httpx.Timeout(args.timeout, connect=args.connect_timeout)
    )
    client = OpenAI(
        api_key=args.api_key,
        base_url=args.base_url,
        http_client=http_client,
    )

    result = client.images.generate(
        model=args.model,
        size=args.size,
        prompt=args.prompt,
    )
    image_base64 = result.data[0].b64_json
    image_bytes = base64.b64decode(image_base64)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(image_bytes)

    print(f"saved={output_path}")
    print(f"model={args.model}")
    print(f"size={args.size}")
    print(f"base_url={args.base_url}")
    print(f"timeout={args.timeout}")


if __name__ == "__main__":
    main()
