import argparse
import base64
from pathlib import Path

import httpx
from openai import OpenAI


DEFAULT_PROMPT = (
    "Create a premium README hero banner for an open source developer tool named FeedbackMesh. "
    "Audience: engineers, coding agents, and product teams on GitHub. "
    "Tone: premium, serious, modern, minimal, high-end open-source infrastructure aesthetic. "
    "Visual style: dark cinematic product graphic, crisp interface-style composition, elegant blue-cyan and soft mint accents, "
    "subtle depth, clean layout, readable English labels only, no watermark, no logo from other brands, no purple bias. "
    "Required visual modules: multiple noisy feedback inputs on the left, one central aggregated case card in the middle, "
    "one GitHub issue destination on the right, plus a distinct agent-first onboarding or machine-readable contract panel that makes the product feel installable by an agent. "
    "Include wording that reinforces agent-first onboarding, GitHub-native workflow, and clean issue publication. "
    "The graphic should feel like a refined launch graphic from a top-tier open source infrastructure project."
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="gpt-image-2")
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("--connect-timeout", type=float, default=30.0)
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
