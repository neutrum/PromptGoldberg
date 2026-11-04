/**
 * The things the recipe library knows, by group: the Quick, Draw! categories (the things people
 * draw most), the COCO objects (the things photos show most) and about sixty world landmarks.
 * Each item is "name, synonym, synonym"; the name is what the game shows, every word finds it.
 *
 * Left out on purpose: the kit's own parts and the board's obstacle props (a ball, a fan, a
 * fence, a tree are already real things in the game), the ready-made heroes, ground the terrain
 * makes (hills, rivers), body parts, people and anything abstract.
 */
const GROUPS: Record<string, string> = {
  animals: `cat, kitten; dog, puppy; horse, pony; cow, cattle; pig, piglet; sheep, lamb; goat; chicken, hen, rooster; duck, duckling;
    rabbit, bunny; mouse, mice; squirrel; hedgehog; raccoon; bear, grizzly; panda; lion; tiger; zebra; giraffe; elephant; camel;
    kangaroo; monkey, ape; rhinoceros, rhino; crocodile, alligator; frog, toad; snake; snail; turtle, tortoise, sea turtle;
    owl; parrot; penguin; flamingo; swan; eagle; bird, songbird; bat; butterfly; bee, bumblebee; ant; spider; scorpion;
    fish, goldfish; shark; whale; dolphin; octopus; crab; lobster; deer, reindeer, stag; fox; wolf; moose, elk; dinosaur, t-rex, tyrannosaurus;
    unicorn; teddy bear, teddy; snowman`,
  food: `apple; banana; pear; pineapple; watermelon; strawberry; grapes; cherry, cherries; lemon; orange fruit, an orange; carrot; broccoli;
    mushroom, toadstool; onion; potato; pumpkin, jack-o-lantern; corn, corn cob; peas; peanut; bread, loaf; sandwich; hamburger, burger;
    hot dog; pizza; donut, doughnut; cookie; cake, birthday cake; cupcake; ice cream, ice cream cone; popsicle, ice lolly; lollipop;
    candy cane; cheese, wedge of cheese; egg; steak; sushi; taco; pretzel; croissant`,
  kitchen: `cup, teacup; mug, coffee mug; wine glass; bottle, wine bottle; jar, cookie jar; bowl; plate; fork; spoon; knife;
    frying pan, skillet; saucepan, pot; kettle; toaster; microwave; oven, stove; refrigerator, fridge; dishwasher; sink;
    blender; coffee machine, espresso machine; cauldron; rolling pin; whisk; salt shaker, pepper shaker`,
  home: `chair, armchair; table, dining table; couch, sofa; bed; pillow; dresser, chest of drawers; wardrobe; bookshelf, bookcase;
    desk; lamp, floor lamp, table lamp; chandelier; candle; lantern; clock, wall clock; alarm clock; grandfather clock; hourglass;
    vase; house plant, potted plant, plant pot; picture frame; mirror; door; window; stairs, staircase; ladder; fireplace;
    bathtub, bath; toilet; shower; washing machine; television, tv; radio; telephone; cell phone, smartphone, phone; laptop;
    computer, monitor; keyboard; computer mouse; remote control; camera; headphones; speaker, stereo; light bulb; power outlet;
    mailbox, letterbox; umbrella; suitcase; backpack; purse, handbag; basket; book; envelope; gift, gift box; treasure chest;
    piggy bank; key; lock, padlock; trophy; crown; globe; planet`,
  tools: `axe; hand saw; drill; pliers; shovel, spade; rake; broom; paintbrush; paint can; scissors; flashlight, torch; magnifying glass;
    binoculars; telescope; microscope; compass; magnet; anvil; toolbox; wheelbarrow; watering can; garden hose; tape measure;
    paper clip; crayon; marker; eraser; calculator; stapler; megaphone; microphone; stethoscope; first aid kit`,
  music: `guitar; violin; cello; harp; piano; drum, drums, drum kit; trumpet; trombone; saxophone; clarinet; flute; accordion; banjo; xylophone`,
  sport: `basketball hoop; soccer goal, football goal; baseball bat; baseball glove; tennis racket; golf club; hockey stick; hockey puck;
    skateboard; skis; snowboard; surfboard; frisbee; kite; dumbbell;  bowling pin, skittle; boxing glove; sled, sledge;
    roller skates; helmet; diving board; swing set, swing, swings; playground slide, slide, playground; see-saw toy`,
  clothes: `hat, top hat; cap, baseball cap; witch hat; cowboy hat; shoe, sneaker; boot; sock; t-shirt; sweater, jumper; jacket;
    pants, trousers; shorts; dress; bow tie; necklace; bracelet; glasses, eyeglasses; sunglasses; wristwatch; mitten, glove; scarf`,
  vehicles: `car; sports car, race car; police car; taxi, cab; bus; school bus; van; pickup truck; truck, lorry; fire truck, fire engine;
    ambulance; tractor; bulldozer; excavator, digger; dump truck; forklift; cement mixer; crane, construction crane; motorcycle, motorbike;
    bicycle, bike; scooter; train, locomotive, steam train; tram, streetcar; airplane, aeroplane, plane, jet; helicopter; hot air balloon, balloon;
    blimp, airship, zeppelin; glider; sailboat, sailing boat, boat; speedboat, motorboat; canoe, kayak; rowboat; cruise ship, ocean liner;
    aircraft carrier; submarine; pirate ship; tugboat; space shuttle; flying saucer, ufo; satellite; lunar lander; mars rover;
    horse carriage, carriage, stagecoach; wagon, covered wagon; gondola`,
  street: `traffic light; stop sign; streetlight, street lamp, lamppost; fire hydrant; parking meter; bench, park bench; bus stop;
    phone booth, telephone box; trash can, bin, dustbin; signpost; road sign; traffic cone; fountain; wishing well;
    statue; bridge; arch bridge; tunnel entrance, tunnel; cave entrance, cave, cavern; lighthouse; igloo; volcano; flower bed, flowers, flower; tower; clock tower; water tower; bell tower, belfry; skyscraper; house, cottage, home;
    barn, farm, farmhouse; silo; greenhouse; shed; garage; gas station, petrol station; shop, store; market stall; cafe; restaurant; school;
    hospital; fire station; police station; church; chapel; temple; mosque; pagoda; palace; hut; tent; teepee, tipi; yurt;
    treehouse; log pile, woodpile; scarecrow; haystack, hay bale; beehive; birdhouse; doghouse, kennel; picnic table; campfire;
    gazebo; pier, jetty; dock; buoy; wind turbine; solar panel; satellite dish; radio tower, antenna mast; power pylon; oil derrick;
    factory; chimney; mine cart; ski lift, chairlift; cable car; carousel, merry-go-round; ferris wheel; roller coaster;
    circus tent, big top; castle tower; drawbridge; lookout tower, watchtower; observatory`,
  fantasy: `tombstone, gravestone, headstone; coffin; skull; ghost; witch broom; magic wand; wizard tower, wizard;
    crystal ball; potion bottle; spellbook; throne; sword; shield; knight armor, suit of armor; catapult; treasure pile, gold coins;
    totem pole; obelisk; sarcophagus; mummy case; dragon egg; fairy house, mushroom house; giant mushroom; gingerbread house;
    christmas tree; present stack; menorah; easter egg; snow globe; rocket launch pad; space station; alien; robot dog; time machine`,
  landmarks: `Great Wall of China, great wall; Taj Mahal; Colosseum, colosseo; Leaning Tower of Pisa, tower of pisa, pisa;
    Big Ben, elizabeth tower; Tower Bridge; London Eye; Sydney Opera House, opera house; Christ the Redeemer, cristo redentor;
    Great Pyramid, pyramids, pyramid, giza; Sphinx, great sphinx; Machu Picchu; Stonehenge; Golden Gate Bridge, golden gate;
    Mount Rushmore; Empire State Building; Burj Khalifa; Parthenon, acropolis; Arc de Triomphe; Sagrada Familia;
    Saint Basil's Cathedral, st basil's, saint basils; Brandenburg Gate; Neuschwanstein Castle, neuschwanstein; Petronas Towers;
    CN Tower; Space Needle; Tokyo Tower; Mount Fuji, fuji; Angkor Wat; Petra, al-khazneh; Chichen Itza, mayan pyramid;
    Moai, easter island head, easter island; Notre-Dame, notre dame; Louvre Pyramid, louvre; Atomium; Hagia Sophia;
    Torii gate, torii; Kinkaku-ji, golden pavilion; Alhambra; White House; Capitol, us capitol; Washington Monument;
    Lincoln Memorial; Hollywood sign, hollywood; Gateway Arch, st louis arch; Bratislava Castle;
    Bojnice Castle; Devin Castle; Charles Bridge, prague; Hungarian Parliament, budapest parliament; Kremlin, spasskaya tower;
    Dutch windmill, kinderdijk; Matterhorn; Duomo, florence cathedral; Rialto Bridge, venice; Tower of London;
    Buckingham Palace; Forbidden City, tiananmen; Statue of Zeus; Lighthouse of Alexandria; Hanging Gardens;
    Cologne Cathedral, kolner dom; Kriváň, krivan; Lomnický štít observatory, lomnicky stit`,
};

export interface CatalogItem {
  /** Lowercase slug of the name, the key of its recipe. */
  id: string;
  name: string;
  group: string;
  /** Every phrase that finds it, the name first, all lowercase. */
  words: string[];
}

export const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Lowercase, accents off, punctuation to spaces: how words are compared. */
export const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export const CATALOG: CatalogItem[] = Object.entries(GROUPS).flatMap(([group, text]) =>
  text.split(';').map((item) => item.split(',').map((w) => w.trim()).filter(Boolean)).filter((w) => w.length).map((words) => ({
    id: slug(words[0]), name: words[0], group, words: [...new Set(words.map(plain))],
  })));
