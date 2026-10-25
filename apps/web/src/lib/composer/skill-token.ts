const LEADING_TOKEN = /^\/(?<name>[^\s]+)(?=\s|$)/u;

/** Only a complete, leading skill from the current catalog is recognized. */
export const skillTokenLength = (
  text: string,
  commands: readonly { name: string; kind: string }[]
) => {
  const token = LEADING_TOKEN.exec(text);
  return token &&
    commands.some(
      (command) =>
        command.kind === "skill" && command.name === token.groups?.name
    )
    ? token[0].length
    : 0;
};
