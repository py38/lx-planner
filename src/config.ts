// Interrupteurs de publication (retour en arrière rapide, sans toucher aux données).

/**
 * Onglet LX Academy visible.
 * Mettre `false` puis publier = retour en arrière de la phase 1 : l'onglet disparaît (menu ordinateur, barre iPhone,
 * adresse #/academy), mais RIEN n'est supprimé ni modifié : les fiches Academy restent sur l'appareil et sur le serveur,
 * continuent d'être synchronisées et sauvegardées, et réapparaissent telles quelles en remettant `true`.
 * Ne jamais remettre en ligne le code d'avant la phase 1 à la place (voir E7 dans le plan).
 */
export const ACADEMY_VISIBLE = true;
