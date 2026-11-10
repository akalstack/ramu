/** A diff past this is shown one file at a time, so a large change opens fast and is read file by file. */
export const isLargeDiff = (files: number, changedLines: number) => files > 25 || changedLines > 2500
