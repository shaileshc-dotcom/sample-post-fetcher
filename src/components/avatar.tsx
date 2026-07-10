"use client";

export const AVATAR_PRESETS: Record<string, string> = {
  "preset:1": "linear-gradient(135deg,#f0b94e,#ff6b8a)",
  "preset:2": "linear-gradient(135deg,#34d6a0,#3aa0ff)",
  "preset:3": "linear-gradient(135deg,#8b7bf0,#ff6b8a)",
  "preset:4": "linear-gradient(135deg,#3aa0ff,#8b7bf0)",
  "preset:5": "linear-gradient(135deg,#ff6b8a,#f0b94e)",
  "preset:6": "linear-gradient(135deg,#34d6a0,#f0b94e)",
};

export function Avatar({ avatar, name, size = 32 }: { avatar?: string; name?: string; size?: number }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  if (avatar && avatar.startsWith("data:")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt="avatar" width={size} height={size} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
  }
  const bg = AVATAR_PRESETS[avatar || ""] || AVATAR_PRESETS["preset:1"];
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, display: "grid", placeItems: "center", color: "#241300", fontWeight: 700, fontSize: size * 0.42 }}>
      {initial}
    </div>
  );
}
