/** Seconds of unpaused game time; these are local activity budgets, never world-wide caps. */
export const POPULATION={
 tick:5,chunkRadius:2,extraAsteroidCandidates:32,asteroidBudget:2400,asteroidArrivalsPerTick:2,placementAttempts:4,
 asteroidIntervals:{iron:[120,300],copper:[120,300],ice:[180,300],crystal:[480,900],radioactive:[480,900]},
 asteroidDrift:[1,4],ambientChance:.2,ambientDrift:[1.5,3.5],ambientRange:360,ambientBaseClearance:650,spawnMargin:140,baseClearance:300,asteroidGap:18,playerClearance:260,retry:10,
 enemyRegionSize:3600,enemyArrivalsPerTick:3,enemyBudget:36,enemyLoadRadius:3200,enemyUnloadRadius:4200,enemyMinDistance:900,
 threats:{low:{normal:5,elite:0,normalInterval:[120,180],eliteInterval:[480,600]},medium:{normal:8,elite:2,normalInterval:[90,150],eliteInterval:[360,600]},high:{normal:12,elite:4,normalInterval:[60,120],eliteInterval:[300,480]}},
 bossInterval:[1200,1800],
} as const;

export const BELT_MOTION={largeSpeed:[2,8],smallSpeed:[5,12],streamInterval:2,jitter:12,cacheChunks:256,dropInheritance:.5,spin:.025} as const;
