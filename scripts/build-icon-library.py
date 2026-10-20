#!/usr/bin/env python3
"""Compose OpenTab shortcut tiles from Simple Icons 16.35.0 (CC0-1.0).

Reads the npm pack at /tmp/simple-icons-pack/package and writes
icons/library/<slug>.svg — a 128px rounded square with the brand mark.
Run from the repository root. Output is committed; this script documents
provenance so the tiles are not anonymous downloads.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACK = Path("/tmp/simple-icons-pack/package")
OUT = ROOT / "icons" / "library"

# slug, hex, region, hosts...
LIBRARY = [
    ("baidu", "2932E1", "cn", "baidu.com"),
    ("taobao", "E94F20", "cn", "taobao.com"),
    ("bilibili", "00A1D6", "cn", "bilibili.com,b23.tv"),
    ("zhihu", "0084FF", "cn", "zhihu.com"),
    ("sinaweibo", "E6162D", "cn", "weibo.com,weibo.cn"),
    ("wechat", "07C160", "cn", "weixin.qq.com,wechat.com"),
    ("qq", "1EBAFC", "cn", "qq.com,qzone.qq.com"),
    ("alipay", "1677FF", "cn", "alipay.com"),
    ("xiaohongshu", "FF2442", "cn", "xiaohongshu.com,xhslink.com"),
    ("gitee", "C71D23", "cn", "gitee.com"),
    ("huawei", "FF0000", "cn", "huawei.com,vmall.com"),
    ("xiaomi", "FF6900", "cn", "mi.com,xiaomi.com"),
    ("meituan", "FFD100", "cn", "meituan.com"),
    ("kuaishou", "FF4906", "cn", "kuaishou.com"),
    ("neteasecloudmusic", "D43C33", "cn", "music.163.com"),
    ("tripdotcom", "287DFA", "cn", "trip.com,ctrip.com"),
    ("bytedance", "3C8CFF", "cn", "bytedance.com"),
    ("alibabadotcom", "FF6A00", "cn", "alibaba.com,1688.com"),
    ("alibabacloud", "FF6A00", "cn", "aliyun.com,alibabacloud.com"),
    ("csdn", "FC5531", "cn", "csdn.net"),
    ("juejin", "007FFF", "cn", "juejin.cn"),
    ("v2ex", "1F1F1F", "cn", "v2ex.com"),
    ("github", "181717", "intl", "github.com,gist.github.com"),
    ("youtube", "FF0000", "intl", "youtube.com,youtu.be"),
    ("google", "4285F4", "intl", "google.com"),
    ("gmail", "EA4335", "intl", "gmail.com,mail.google.com"),
    ("x", "000000", "intl", "x.com,twitter.com"),
    ("facebook", "0866FF", "intl", "facebook.com,fb.com"),
    ("instagram", "FF0069", "intl", "instagram.com"),
    ("reddit", "FF4500", "intl", "reddit.com"),
    ("wikipedia", "000000", "intl", "wikipedia.org"),
    ("netflix", "E50914", "intl", "netflix.com"),
    ("apple", "000000", "intl", "apple.com"),
    ("icloud", "3693F3", "intl", "icloud.com"),
    ("stackoverflow", "F58025", "intl", "stackoverflow.com"),
    ("discord", "5865F2", "intl", "discord.com,discord.gg"),
    ("telegram", "26A5E4", "intl", "telegram.org,web.telegram.org,t.me"),
    ("whatsapp", "25D366", "intl", "whatsapp.com,wa.me"),
    ("twitch", "9146FF", "intl", "twitch.tv"),
    ("spotify", "1ED760", "intl", "spotify.com"),
    ("duckduckgo", "DE5833", "intl", "duckduckgo.com"),
    ("gitlab", "FC6D26", "intl", "gitlab.com"),
    ("tiktok", "000000", "intl", "tiktok.com,douyin.com"),
    ("pinterest", "BD081C", "intl", "pinterest.com"),
]


def luminance(hex_color: str) -> float:
    n = int(hex_color, 16)
    r, g, b = (n >> 16) & 255, (n >> 8) & 255, n & 255
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0


def inner_markup(svg: str) -> str:
    text = re.sub(r"<svg[^>]*>", "", svg, count=1, flags=re.I)
    text = re.sub(r"</svg>\s*$", "", text, flags=re.I)
    text = re.sub(r"<title>[^<]*</title>", "", text, flags=re.I)
    return text.strip()


def compose(slug: str, hex_color: str, source_svg: str) -> str:
    glyph = "#1a1a1a" if luminance(hex_color) > 0.62 else "#ffffff"
    inner = inner_markup(source_svg)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img">'
        f'<rect width="128" height="128" rx="28" fill="#{hex_color}"/>'
        f'<g transform="translate(28 28) scale(3)" fill="{glyph}">{inner}</g>'
        "</svg>\n"
    )


def main() -> None:
    data = json.loads((PACK / "data" / "simple-icons.json").read_text(encoding="utf-8"))
    by_slug = {item["slug"]: item for item in data}
    OUT.mkdir(parents=True, exist_ok=True)
    missing = []
    for slug, hex_color, _region, _hosts in LIBRARY:
        item = by_slug.get(slug)
        if not item:
            missing.append(slug)
            continue
        if item.get("license") and item["license"].get("type") not in {
            "CC0-1.0",
            "Apache-2.0",
            "MIT",
            "BSD-2-Clause",
            "BSD-3-Clause",
            "ISC",
            "Unlicense",
        }:
            # Icons without a SPDX field inherit the Simple Icons CC0 project
            # license; skip copyleft / NC / custom entries explicitly marked.
            if item["license"].get("type") not in {None, ""}:
                missing.append(f"{slug} license={item['license']}")
                continue
        src = PACK / "icons" / f"{slug}.svg"
        if not src.exists():
            missing.append(slug)
            continue
        (OUT / f"{slug}.svg").write_text(
            compose(slug, hex_color, src.read_text(encoding="utf-8")),
            encoding="utf-8",
        )
    license_src = PACK / "LICENSE.md"
    if license_src.exists():
        (OUT / "SIMPLE-ICONS-LICENSE.md").write_text(
            license_src.read_text(encoding="utf-8"), encoding="utf-8"
        )
    meta = [
        {
            "slug": slug,
            "hex": hex_color,
            "region": region,
            "hosts": [h for h in hosts.split(",") if h],
        }
        for slug, hex_color, region, hosts in LIBRARY
    ]
    (OUT / "catalog.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if missing:
        raise SystemExit("missing or skipped: " + ", ".join(missing))
    print(f"wrote {len(LIBRARY)} tiles to {OUT}")


if __name__ == "__main__":
    main()
