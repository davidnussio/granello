// Testi che cambiano con il sistema: come si chiama il computer, dove restano le chiavi.
import { t } from "./i18n";
import { byOs } from "./platform";

/** Il computer, come lo chiama il sistema: "questo Mac" oppure "questo computer". */
export const thisDevice = () => byOs(t("questo Mac"), t("questo computer"));

/** Dove restano le API key: nel Portachiavi, in Gestione credenziali o in un file privato. */
export const keyStore = () =>
  byOs(t("nel Portachiavi"), t("in Gestione credenziali"), t("in un file leggibile solo da te"));
