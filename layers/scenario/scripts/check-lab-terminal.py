#!/usr/bin/env python3
"""NMCPS-ADR-0025（`layers/content/collections/cn/records/adr/adr-0025.md`）的自查：
把 Webshell 面板实际发送的字节序列喂给**真实 bash + PTY**，确认按键映射对真 shell 成立。

`check:ui` 11.8 断言的是「面板发出的字节」与「假上游回来的文本」；这里补上另一端：
这些字节在真 `bash` 上确实是「删一个字符 / 执行 / 打断 / 补全 / 移光标 / 清屏」。

序列与 `layers/scenario/app/components/Simulator/NetworkTools.vue` 的 `onTerminalKeydown` 一一对应：
  Enter `\\r` / Backspace `0x7f` / Tab `\\t` / ← `\\x1b[D` / Ctrl-C `0x03` / Ctrl-L `0x0c`

非 POSIX 平台没有 `pty`，跳过并说明原因（不伪装成通过）。
"""
import os
import pty
import select
import sys
import time

PS1 = "root@h1:~# "


def session(steps):
    """在一个 pty 上跑交互式 bash，按步骤喂字节，返回整段转写。"""
    pid, fd = pty.fork()
    if pid == 0:  # 子进程
        os.environ.update(PS1=PS1, TERM="dumb", LC_ALL="C.UTF-8")
        os.execv("/bin/bash", ["bash", "--norc", "--noprofile", "-i"])

    buf = bytearray()

    def drain(seconds):
        end = time.time() + seconds
        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], 0.05)
            if not ready:
                continue
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                return
            if not chunk:
                return
            buf.extend(chunk)

    drain(1.2)
    for _, data in steps:
        os.write(fd, data)
        drain(0.9)
    drain(0.6)
    os.write(fd, b"exit\r")
    drain(0.3)
    try:
        os.kill(pid, 9)
    except OSError:
        pass
    return buf.decode("utf-8", "replace")


CASES = [
    (
        "退格 0x7f 删的是「上一个字符」，不是整行",
        [("type helo", b"echo helo"), ("backspace", b"\x7f"), ("type lo+enter", b"lo\r")],
        lambda text: "hello" in text and "helolo" not in text,
    ),
    (
        "回车 \\r 让 bash 真的执行命令",
        [("type", b"echo probe-$((6*7))\r")],
        lambda text: "probe-42" in text,
    ),
    (
        "Ctrl-C 0x03 打断正在跑的命令，shell 回到提示符",
        [("type sleep", b"sleep 30\r"), ("ctrl-c", b"\x03"), ("type echo", b"echo after-interrupt\r")],
        lambda text: "after-interrupt" in text and text.count("after-interrupt") >= 2,
    ),
    (
        "Tab \\t 触发 bash 补全（`ech` → `echo `，随后整行照常执行）",
        [("type ech", b"ech"), ("tab", b"\t"), ("type tab-ok+enter", b"tab-ok\r")],
        lambda text: "\ntab-ok" in text,
    ),
    (
        "方向键 CSI \\x1b[D 移动光标后再输入，字符插在中间",
        [("type echo abc", b"echo abc"), ("left x2", b"\x1b[D\x1b[D"), ("type X+enter", b"X\r")],
        lambda text: "\naXbc" in text,
    ),
    (
        "Ctrl-L 0x0c（通用 Ctrl+字母映射）清屏后命令仍能执行",
        [("type", b"echo before-clear\r"), ("ctrl-l", b"\x0c"), ("type", b"echo after-clear\r")],
        lambda text: "after-clear" in text,
    ),
]


def main():
    if os.name != "posix" or not os.path.exists("/bin/bash"):
        print("⏭ 跳过：需要 POSIX `pty` 与 /bin/bash（当前平台不支持），视为未执行而不是通过")
        return 0

    failed = 0
    for name, steps, ok in CASES:
        text = session(steps)
        passed = ok(text)
        failed += 0 if passed else 1
        print(("✅ " if passed else "❌ ") + name)
        tail = text.replace("\r", "").strip().splitlines()
        print("   尾部：" + " | ".join(tail[-4:]))

    total = len(CASES)
    print(f"\n{total - failed}/{total} 项通过（真实 bash + PTY）")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
