// The one place that knows which systems exist. Add new game systems here.
import { registerSystem } from "./registry.js";
import pokemonDnd from "./pokemon-dnd/index.js";
import dnd5e from "./dnd5e/index.js";

registerSystem(pokemonDnd);
registerSystem(dnd5e);

export { listSystems, getSystem, setActiveSystem, activeSystem, viewsOf } from "./registry.js";
