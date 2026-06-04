export const APP_NAME = "KindCut";

export const LANGUAGES = ["nl", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "nl";
export const LANGUAGE_STORAGE_KEY = "kindcutLanguage";

const translations = {
  nl: {
    "app.name": APP_NAME,
    "language.label": "Taal",
    "language.nl": "Nederlands",
    "language.en": "English",
    "welcome.eyebrow": "Lokale knutselhulp",
    "welcome.lede":
      "Beschrijf een kaart of eenvoudig Cricut Joy-project, bekijk wat getekend en gesneden wordt, en bewaar het daarna op deze computer.",
    "welcome.newProject": "Nieuw project",
    "welcome.newProjectCopy": "Begin rustig met een leeg lokaal ontwerp.",
    "welcome.openProject": "Open project",
    "welcome.openProjectCopy": "Ga verder met een project op deze Mac.",
    "welcome.exampleProject": "Voorbeeldproject",
    "welcome.exampleProjectCopy": "Bekijk meteen een eenvoudige verjaardagskaart.",
    "workspace.eyebrow": "Werkruimte",
    "project.openPlaceholder": "Project openen komt in de volgende werkruimte-stap. Kies nu een afbeelding of voorbeeld om verder te testen.",
    "project.savePlaceholder": "Project bewaren komt in de volgende werkruimte-stap. Je Cricut-plannen blijven voorlopig lokaal bij de voorbereiding.",
    "project.openInDesktop": "Open de desktopapp om KindCut-projecten te openen.",
    "project.saveInDesktop": "Open de desktopapp om KindCut-projecten te bewaren.",
    "project.openEmpty": "Dit projectbestand is leeg.",
    "project.openError": "KindCut kon dit project nog niet openen.",
    "project.saveError": "KindCut kon dit project nog niet bewaren.",
    "project.opened": "Project geopend: {path}",
    "project.saved": "Project bewaard: {path}",
    "buttons.backWelcome": "Terug naar start",
    "buttons.tryBirthdayCard": "Probeer de verjaardagskaart",
    "buttons.preparingPreview": "Voorbeeld voorbereiden...",
    "buttons.checking": "Controleren...",
    "buttons.checkSetupAgain": "Controleer instellingen opnieuw",
    "buttons.chooseSvg": "Kies afbeelding",
    "buttons.preparing": "Voorbereiden...",
    "buttons.prepareHandoff": "Bereid Cricut-overdracht voor",
    "buttons.preparePreview": "Bereid voorbeeld voor",
    "buttons.starting": "Starten...",
    "buttons.startCut": "Start snijden",
    "buttons.continue": "Verder",
    "buttons.stop": "Stop",
    "status.panelLabel": "Cricut-overdracht",
    "status.loadingTitle": "Je snijhulp controleren",
    "status.loadingMessage": "KindCut controleert of projecten straks voorbereid kunnen worden voor je Cricut.",
    "status.initialTitle": "Je knutseltafel klaarzetten",
    "status.initialMessage": "KindCut controleert eerst het hulpje dat nodig is voordat je begint.",
    "status.readyTitle": "Klaar voor Cricut-projecten",
    "status.readyMessage":
      "Alles wat KindCut nodig heeft is beschikbaar. Je kunt beginnen met een eenvoudige kaart en je werk lokaal bewaren.",
    "status.warningTitle": "Een hulpje heeft aandacht nodig",
    "status.warningMessage":
      "KindCut kan het voorbeeldproject nog tonen, maar kan pas een Cricut-overdracht voorbereiden als het hulpje is ingesteld.",
    "workflow.label": "KindCut-werkwijze",
    "workflow.describe": "Beschrijf het",
    "workflow.preview": "Bekijk lagen",
    "workflow.save": "Bewaar lokaal",
    "workflow.send": "Verstuur als je klaar bent",
    "starter.panelLabel": "Startproject",
    "starter.sampleName": "Hondenverjaardagskaart",
    "starter.description":
      "Een kleine kaart met pendetails en een eenvoudige snijrand, op maat voor een beginnersvriendelijke oefenronde met Cricut Joy.",
    "starter.machine": "Machine",
    "starter.mat": "Mat",
    "starter.material": "Materiaal",
    "starter.choiceKicker": "Pas deze keuzes aan voordat je een voorbeeld maakt of een begeleide snijbeurt start.",
    "projectCheck.panelLabel": "Projectcontrole",
    "projectCheck.readyTitle": "Klaar om te bekijken",
    "projectCheck.warningTitle": "Moet even bekeken worden",
    "projectCheck.readyMessage": "Het voorbeeldrecept heeft de basiscontroles voor formaat en lagen.",
    "projectCheck.warningMessage": "Een deel van het voorbeeldrecept heeft aandacht nodig.",
    "import.panelLabel": "Jouw ontwerp",
    "import.title": "Haal een afbeeldingsbestand binnen",
    "import.description":
      "Kies een afbeeldingsbestand van deze computer. KindCut toont een rustige preview en een duidelijke controle voordat iets voor een snijmachine wordt voorbereid.",
    "import.empty": "Nog geen afbeelding gekozen. Begin met een bestand dat je al hebt; KindCut toont het dan hier.",
    "import.chooseSvgFile": "Kies eerst een afbeelding, daarna kan KindCut het voorbereiden.",
    "import.invalidSvg": "Kies een bestand dat eindigt op .svg zodat KindCut het kan tonen.",
    "import.openInShellPlan": "Open dit scherm in de Electron-desktopapp om een Cricut-overdracht voor te bereiden.",
    "import.openError": "KindCut kon dat bestand nog niet openen.",
    "import.planError": "KindCut kon die afbeelding nog niet voorbereiden.",
    "import.prepareNote": "Dit maakt alleen een lokaal plan. Snijden start later, nadat je op Start snijden drukt.",
    "import.previewTitle": "Voorbeeld van {fileName}",
    "import.chosenFile": "Gekozen bestand",
    "import.file": "Bestand",
    "import.artwork": "Tekening",
    "import.readyTitle": "Dit ziet er makkelijk uit om mee te starten",
    "import.warningTitle": "Een paar dingen moeten misschien bekeken worden",
    "import.readyMessage": "KindCut kan deze afbeelding lezen en in de preview tonen.",
    "details.advanced": "Geavanceerde details",
    "details.svgCheck": "SVG-controle details",
    "details.rawSvg": "Ruwe SVG",
    "details.designPrompt": "Ontwerpprompt details",
    "details.handoffCommand": "Overdrachtscommando details",
    "details.cut": "Snijdetails",
    "details.plan": "Plandetails",
    "practice.panelLabel": "Oefenvoorbeeld",
    "practice.title": "Bereid de voorbeeldkaart voor",
    "practice.description":
      "Dit maakt alleen een voorbeeldbestand voor de voorbeeldkaart met het materiaal en de mat die je koos. Er wordt niets naar een Cricut-machine gestuurd.",
    "practice.empty": "Klik hierboven op \"Probeer de verjaardagskaart\" om hier een vriendelijke lagensamenvatting te zien.",
    "later.panelLabel": "Voor later",
    "later.title": "Receptnotities staan netjes apart",
    "later.description":
      "Beginnersschermen blijven eenvoudig, terwijl de app de prompt en overdrachtsnotities beschikbaar houdt voor probleemoplossing.",
    "plan.readyTitle": "Oefenvoorbeeld is klaar",
    "plan.warningTitle": "Het oefenvoorbeeld kon niet worden voorbereid",
    "plan.warningMessage":
      "Het voorbeeldproject staat nog hier. De Cricut-overdrachthulp heeft aandacht nodig voordat KindCut het kan bekijken.",
    "validation.projectRecipeConsistent": "Het projectrecept klopt intern.",
    "plan.importedPanelLabel": "Overdracht van geïmporteerde afbeelding",
    "plan.readyToSendTitle": "Klaar om te versturen wanneer jij zover bent",
    "plan.currentPlan": "Huidig plan:",
    "plan.layers": "Lagen",
    "plan.tools": "Gereedschap",
    "plan.noTools": "Geen gereedschap vermeld",
    "plan.startCutNote": "Druk hier alleen op als de Cricut dichtbij staat, aangesloten is, en je klaar bent om mee te kijken.",
    "cut.panelLabel": "Begeleide Cricut-stap",
    "cut.progressLabel": "Voortgang van het snijden",
    "cut.preparePlan": "Plan maken",
    "cut.loadTool": "Gereedschap laden",
    "cut.loadMat": "Mat laden",
    "cut.cutDraw": "Snijden/tekenen",
    "cut.finish": "Afronden",
    "cut.noMessages": "Nog geen SliceBug-berichten.",
    "choice.aria": "Materiaal- en matkeuzes",
    "choice.material": "Materiaal",
    "choice.mat": "Mat",
    "size.unknown": "De afmeting staat nog niet in dit bestand.",
    "size.about": "Ongeveer {width} x {height} {unit}",
    "size.artworkUnits": "tekeneenheden",
    "svg.issue.notSvg": "Dit lijkt geen SVG-bestand. Kies een .svg uit je ontwerp-app.",
    "svg.issue.generic": "KindCut kon deze SVG nog niet lezen. Exporteer hem opnieuw als gewone SVG.",
    "svg.warning.effects": "Sommige visuele effecten komen misschien niet precies mee in een snijproject.",
    "svg.warning.text": "Er staat bewerkbare tekst in. Voor het beste resultaat: zet de woorden om naar vormen.",
    "svg.warning.noPaths": "KindCut ziet een tekening, maar heeft misschien vormlijnen nodig voordat snijlijnen gemaakt kunnen worden.",
    "svg.warning.generic": "Dit bestand moet misschien even bekeken worden voordat het klaar is voor een snijproject.",
    "tool.fine_point_blade": "Fijn mesje",
    "tool.pen": "Pen",
    "colors.sectionTitle": "Kaartkleuren",
    "colors.paper": "Papierkleur",
    "colors.behind": "Kleur erachter",
    "pens.sectionTitle": "Pennen",
    "pens.add": "Pen toevoegen",
    "pens.remove": "Pen verwijderen",
    "pens.fix": "Oplossen",
    "warn.penDuplicate": "Twee pennen hebben dezelfde kleur.",
    "object.tool": "Gereedschap",
    "warn.penOnPaper": "Deze pen heeft dezelfde kleur als het papier — je ziet hem niet.",
    "warn.penOnBehind": "Deze pen heeft dezelfde kleur als de kleur erachter.",
    "material.218.name": "Licht karton",
    "material.218.copy": "Beste eerste keuze voor eenvoudige kaarten en testsneden.",
    "material.19.name": "Middelzwaar karton",
    "material.19.copy": "Steviger kaartpapier voor alledaagse projecten.",
    "material.211.name": "Zwaar karton",
    "material.211.copy": "Dikker papier dat misschien een frisser mesje nodig heeft.",
    "material.535.name": "Insteekkaart",
    "material.535.copy": "Gebruik dit voor Cricut Joy-insteekkaarten.",
    "material.20.name": "Vinyl",
    "material.20.copy": "Gebruik dit voor een eenvoudig ontwerp met plakvinyl.",
    "mat.joy-standard.name": "Joy standaardmat",
    "mat.joy-standard.copy": "De gewone Joy-mat voor de meeste kleine projecten.",
    "mat.joy-standard-short.name": "Joy korte mat",
    "mat.joy-standard-short.copy": "Handig voor kleine restjes en mini-ontwerpen.",
    "mat.joy-card.name": "Joy kaartmat",
    "mat.joy-card.copy": "Beste keuze voor insteekkaarten en gevouwen kaartblanks.",
    "cutAction.finished.title": "Snijden is klaar",
    "cutAction.finished.message": "Haal de mat eruit wanneer de machine stil is.",
    "cutAction.load-mat.title": "Laad de mat",
    "cutAction.load-mat.message": "Leg het materiaal op de mat en laad die in de Cricut. Druk daarna op Verder.",
    "cutAction.load-tools.title": "Laad het gereedschap",
    "cutAction.load-tools.message": "Plaats de gevraagde pen of het mesje in de klem. Druk daarna op Verder.",
    "cutAction.press-go.title": "Start wanneer de machine klaar is",
    "cutAction.press-go.message": "Druk op Go op de Cricut of ga verder wanneer SliceBug daarom vraagt.",
    "cutAction.replace-tool.title": "Wissel het gereedschap",
    "cutAction.replace-tool.message": "Plaats het volgende gereedschap en druk daarna hier op Verder.",
    "cutAction.running.title": "Nu aan het snijden",
    "cutAction.running.message": "De Cricut is bezig. Houd handen weg en wacht op de volgende vraag.",
    "cutAction.error.title": "Iets heeft aandacht nodig",
    "cutAction.error.message": "SliceBug meldt een probleem. Stop hier en bekijk de details.",
    "cutAction.idle.title": "Wachten op SliceBug",
    "cutAction.idle.message": "KindCut luistert naar de volgende snijstap.",
  },
  en: {
    "app.name": APP_NAME,
    "language.label": "Language",
    "language.nl": "Nederlands",
    "language.en": "English",
    "welcome.eyebrow": "Local craft helper",
    "welcome.lede":
      "Describe a card or simple Cricut Joy project, preview what will draw and cut, then save it on this computer for later.",
    "welcome.newProject": "New project",
    "welcome.newProjectCopy": "Start gently with a blank local design.",
    "welcome.openProject": "Open project",
    "welcome.openProjectCopy": "Continue with a project on this computer.",
    "welcome.exampleProject": "Example project",
    "welcome.exampleProjectCopy": "Jump into a simple birthday card preview.",
    "workspace.eyebrow": "Workspace",
    "project.openPlaceholder": "Opening saved projects belongs in the next workspace step. For now, choose an image or example to keep testing.",
    "project.savePlaceholder": "Saving projects belongs in the next workspace step. Cricut plans stay local during preparation for now.",
    "project.openInDesktop": "Open the desktop app to open KindCut projects.",
    "project.saveInDesktop": "Open the desktop app to save KindCut projects.",
    "project.openEmpty": "This project file is empty.",
    "project.openError": "KindCut could not open this project yet.",
    "project.saveError": "KindCut could not save this project yet.",
    "project.opened": "Project opened: {path}",
    "project.saved": "Project saved: {path}",
    "buttons.backWelcome": "Back to welcome",
    "buttons.tryBirthdayCard": "Try the birthday card",
    "buttons.preparingPreview": "Preparing preview...",
    "buttons.checking": "Checking...",
    "buttons.checkSetupAgain": "Check setup again",
    "buttons.chooseSvg": "Choose image",
    "buttons.preparing": "Preparing...",
    "buttons.prepareHandoff": "Prepare Cricut handoff",
    "buttons.preparePreview": "Prepare preview",
    "buttons.starting": "Starting...",
    "buttons.startCut": "Start cut",
    "buttons.continue": "Continue",
    "buttons.stop": "Stop",
    "status.panelLabel": "Cricut handoff",
    "status.loadingTitle": "Checking your cutter helper",
    "status.loadingMessage": "KindCut is making sure it can prepare projects for your Cricut later.",
    "status.initialTitle": "Getting your craft table ready",
    "status.initialMessage": "KindCut will check the helper it needs before you start.",
    "status.readyTitle": "Ready for Cricut projects",
    "status.readyMessage":
      "Everything KindCut needs is available. You can start with a simple card and save your work locally.",
    "status.warningTitle": "One helper needs attention",
    "status.warningMessage":
      "KindCut can still show the sample project, but it cannot prepare a Cricut handoff until the helper app is set up.",
    "workflow.label": "KindCut workflow",
    "workflow.describe": "Describe it",
    "workflow.preview": "Preview layers",
    "workflow.save": "Save locally",
    "workflow.send": "Send when ready",
    "starter.panelLabel": "Starter project",
    "starter.sampleName": "Dog birthday card",
    "starter.description":
      "A small card recipe with pen details and one simple cut border, sized for a beginner-friendly Cricut Joy practice run.",
    "starter.machine": "Machine",
    "starter.mat": "Mat",
    "starter.material": "Material",
    "starter.choiceKicker": "Adjust these choices before preparing a preview or starting a watched cut.",
    "projectCheck.panelLabel": "Project check",
    "projectCheck.readyTitle": "Looks ready to preview",
    "projectCheck.warningTitle": "Needs a quick look",
    "projectCheck.readyMessage": "The sample recipe has the basic size and layer checks it needs.",
    "projectCheck.warningMessage": "One part of the sample recipe needs attention.",
    "import.panelLabel": "Your design",
    "import.title": "Bring in an image file",
    "import.description":
      "Pick an image file from this computer. KindCut will show a gentle preview and a plain-English check before anything is prepared for a cutter.",
    "import.empty": "No image chosen yet. Start with a file you already have, then KindCut will show it here.",
    "import.chooseSvgFile": "Choose an image first, then KindCut can prepare it.",
    "import.invalidSvg": "Choose a file that ends in .svg so KindCut can preview it.",
    "import.openInShellPlan": "Open this screen in the Electron desktop shell to prepare a Cricut handoff.",
    "import.openError": "KindCut could not open that file yet.",
    "import.planError": "KindCut could not prepare that image yet.",
    "import.prepareNote": "This makes a local plan only. Cutting starts later, after you press Start cut.",
    "import.previewTitle": "Preview of {fileName}",
    "import.chosenFile": "Chosen file",
    "import.file": "File",
    "import.artwork": "Artwork",
    "import.readyTitle": "This looks easy to start with",
    "import.warningTitle": "A few things may need a look",
    "import.readyMessage": "KindCut can read this image and show it in the preview.",
    "details.advanced": "Advanced details",
    "details.svgCheck": "SVG check details",
    "details.rawSvg": "Raw SVG",
    "details.designPrompt": "Design prompt details",
    "details.handoffCommand": "Handoff command details",
    "details.cut": "Cut details",
    "details.plan": "Plan details",
    "practice.panelLabel": "Practice preview",
    "practice.title": "Prepare the sample card",
    "practice.description":
      "This only prepares a preview file for the sample card with the material and mat you chose. It will not send anything to a Cricut machine.",
    "practice.empty": "Click \"Try the birthday card\" above to see a friendly layer summary here.",
    "later.panelLabel": "For later",
    "later.title": "Recipe notes are tucked away",
    "later.description":
      "Beginner screens stay simple, while the app still keeps the prompt and handoff notes available when someone needs to troubleshoot.",
    "plan.readyTitle": "Practice preview is ready",
    "plan.warningTitle": "The practice preview could not be prepared",
    "plan.warningMessage":
      "The sample project is still here. The Cricut handoff helper needs attention before KindCut can preview it.",
    "validation.projectRecipeConsistent": "Project recipe is internally consistent.",
    "plan.importedPanelLabel": "Imported image handoff",
    "plan.readyToSendTitle": "Ready to send when you are",
    "plan.currentPlan": "Current plan:",
    "plan.layers": "Layers",
    "plan.tools": "Tools",
    "plan.noTools": "No tools listed",
    "plan.startCutNote": "Only press this when the Cricut is nearby, plugged in, and you are ready to watch it.",
    "cut.panelLabel": "Watched Cricut step",
    "cut.progressLabel": "Cutting progress guide",
    "cut.preparePlan": "Prepare plan",
    "cut.loadTool": "Load tool",
    "cut.loadMat": "Load mat",
    "cut.cutDraw": "Cut/draw",
    "cut.finish": "Finish",
    "cut.noMessages": "No SliceBug messages yet.",
    "choice.aria": "Material and mat choices",
    "choice.material": "Material",
    "choice.mat": "Mat",
    "size.unknown": "Size is not listed in this file yet.",
    "size.about": "About {width} x {height} {unit}",
    "size.artworkUnits": "artwork units",
    "svg.issue.notSvg": "This does not look like an SVG file. Choose an .svg exported from your design app.",
    "svg.issue.generic": "KindCut could not read this SVG yet. Try exporting it again as a plain SVG.",
    "svg.warning.effects": "Some visual effects may not come through exactly when this becomes a cutter project.",
    "svg.warning.text": "It includes editable text. For best results, turn the words into shapes before cutting.",
    "svg.warning.noPaths": "KindCut sees artwork, but it may need shape outlines before cut lines can be prepared.",
    "svg.warning.generic": "This file may need a quick look before it is ready for a cutter project.",
    "tool.fine_point_blade": "Fine-point blade",
    "tool.pen": "Pen",
    "colors.sectionTitle": "Card colors",
    "colors.paper": "Paper color",
    "colors.behind": "Behind color",
    "pens.sectionTitle": "Pens",
    "pens.add": "Add pen",
    "pens.remove": "Remove pen",
    "pens.fix": "Fix",
    "warn.penDuplicate": "Two pens have the same color.",
    "object.tool": "Tool",
    "warn.penOnPaper": "This pen is the same color as the paper — it won't show.",
    "warn.penOnBehind": "This pen is the same color as the behind color.",
    "material.218.name": "Light Cardstock",
    "material.218.copy": "Best first choice for simple cards and test cuts.",
    "material.19.name": "Medium Cardstock",
    "material.19.copy": "A sturdier card paper for everyday projects.",
    "material.211.name": "Heavy Cardstock",
    "material.211.copy": "Thicker paper that may need a fresher blade.",
    "material.535.name": "Insert Card",
    "material.535.copy": "Use this for Cricut Joy insert card blanks.",
    "material.20.name": "Vinyl",
    "material.20.copy": "Use this for a simple adhesive vinyl design.",
    "mat.joy-standard.name": "Joy standard mat",
    "mat.joy-standard.copy": "The everyday Joy mat for most small projects.",
    "mat.joy-standard-short.name": "Joy short mat",
    "mat.joy-standard-short.copy": "Good for small scraps and tiny designs.",
    "mat.joy-card.name": "Joy card mat",
    "mat.joy-card.copy": "Best for insert cards and folded card blanks.",
    "cutAction.finished.title": "Cut is finished",
    "cutAction.finished.message": "Unload the mat when the machine is quiet.",
    "cutAction.load-mat.title": "Load the mat",
    "cutAction.load-mat.message": "Place the material on the mat and load it into the Cricut, then press Continue.",
    "cutAction.load-tools.title": "Load the tool",
    "cutAction.load-tools.message": "Put the requested pen or blade in the clamp, then press Continue.",
    "cutAction.press-go.title": "Start when the machine is ready",
    "cutAction.press-go.message": "Press Go on the Cricut or continue when SliceBug asks.",
    "cutAction.replace-tool.title": "Change the tool",
    "cutAction.replace-tool.message": "Put in the next tool, then press Continue here.",
    "cutAction.running.title": "Cutting now",
    "cutAction.running.message": "The Cricut is working. Keep hands clear and wait for the next prompt.",
    "cutAction.error.title": "Something needs attention",
    "cutAction.error.message": "SliceBug reported a problem. Stop here and check the details.",
    "cutAction.idle.title": "Waiting for SliceBug",
    "cutAction.idle.message": "KindCut is listening for the next cutter step.",
  },
} as const;

export type TranslationKey = keyof (typeof translations)[typeof DEFAULT_LANGUAGE];

export type Translator = {
  language: Language;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
};

export function isLanguage(value: string | null): value is Language {
  return LANGUAGES.includes(value as Language);
}

export function createTranslator(language: Language = DEFAULT_LANGUAGE): Translator {
  return {
    language,
    t: (key, values) => interpolate(translations[language][key], values),
  };
}

export function loadLanguagePreference(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Language {
  try {
    const savedLanguage = storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null;
    return isLanguage(savedLanguage) ? savedLanguage : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function saveLanguagePreference(
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
  language: Language,
): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // localStorage can be unavailable in constrained renderer contexts.
  }
}

export function getMaterialName(materialId: number, language: Language): string | null {
  const { t } = createTranslator(language);
  switch (materialId) {
    case 218:
      return t("material.218.name");
    case 19:
      return t("material.19.name");
    case 211:
      return t("material.211.name");
    case 535:
      return t("material.535.name");
    case 20:
      return t("material.20.name");
    default:
      return null;
  }
}

export function getMaterialBeginnerCopy(materialId: number, language: Language): string | null {
  const { t } = createTranslator(language);
  switch (materialId) {
    case 218:
      return t("material.218.copy");
    case 19:
      return t("material.19.copy");
    case 211:
      return t("material.211.copy");
    case 535:
      return t("material.535.copy");
    case 20:
      return t("material.20.copy");
    default:
      return null;
  }
}

export function getMatName(matId: string, language: Language): string | null {
  const { t } = createTranslator(language);
  switch (matId) {
    case "joy-standard":
      return t("mat.joy-standard.name");
    case "joy-standard-short":
      return t("mat.joy-standard-short.name");
    case "joy-card":
      return t("mat.joy-card.name");
    default:
      return null;
  }
}

export function getMatBeginnerCopy(matId: string, language: Language): string | null {
  const { t } = createTranslator(language);
  switch (matId) {
    case "joy-standard":
      return t("mat.joy-standard.copy");
    case "joy-standard-short":
      return t("mat.joy-standard-short.copy");
    case "joy-card":
      return t("mat.joy-card.copy");
    default:
      return null;
  }
}

export function translateValidationMessage(message: string, language: Language): string {
  const { t } = createTranslator(language);
  if (/Project recipe is internally consistent/i.test(message)) {
    return t("validation.projectRecipeConsistent");
  }
  return message;
}

function interpolate(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
