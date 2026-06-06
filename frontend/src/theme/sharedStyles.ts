import { makeStyles, tokens } from "@fluentui/react-components";

/**
 * Shared layout/utility styles, token-based so they adapt to dark/light themes.
 * Defined once here and called as a hook (`const s = useSharedStyles()`) from
 * any component. Page-specific visuals (compare grid, lightbox, etc.) live in
 * each component's own makeStyles.
 */
export const useSharedStyles = makeStyles({
  // Centered page content column.
  container: {
    maxWidth: "1280px",
    width: "100%",
    marginLeft: "auto",
    marginRight: "auto",
    paddingTop: tokens.spacingVerticalXL,
    paddingBottom: tokens.spacingVerticalXL,
    paddingLeft: tokens.spacingHorizontalXL,
    paddingRight: tokens.spacingHorizontalXL,
  },

  // Flex helpers.
  toolbar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalM,
    marginBottom: tokens.spacingVerticalL,
  },
  spread: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.spacingHorizontalM,
  },
  row: {
    display: "flex",
    columnGap: tokens.spacingHorizontalL,
  },
  col: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalL,
  },
  wrap: { flexWrap: "wrap" },
  grow: { flexGrow: 1 },
  btnRow: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: tokens.spacingHorizontalS,
    rowGap: tokens.spacingVerticalS,
  },

  // Responsive card grid.
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: tokens.spacingHorizontalL,
  },

  // Text helpers.
  muted: { color: tokens.colorNeutralForeground3 },
  small: { fontSize: tokens.fontSizeBase200 },
  mono: { fontFamily: tokens.fontFamilyMonospace },

  // Empty / placeholder state.
  empty: {
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
    paddingTop: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalXXL,
    paddingLeft: tokens.spacingHorizontalL,
    paddingRight: tokens.spacingHorizontalL,
  },

  // Key/value grid (config, params, hyperparameters).
  kv: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    columnGap: tokens.spacingHorizontalL,
    rowGap: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
  },
  kvKey: { color: tokens.colorNeutralForeground3 },
  kvVal: {
    fontFamily: tokens.fontFamilyMonospace,
    minWidth: 0,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },

  // Log / preformatted output.
  log: {
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalS,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    maxHeight: "280px",
    overflowY: "auto",
    color: tokens.colorNeutralForeground2,
    marginTop: tokens.spacingVerticalM,
    marginBottom: 0,
  },

  // Image thumbnail grid (shared by inference image viewer and compare page).
  thumbs: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
    gap: tokens.spacingHorizontalS,
  },
  thumbImg: {
    width: "100%",
    aspectRatio: "1",
    objectFit: "cover",
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: "zoom-in",
  },
});
