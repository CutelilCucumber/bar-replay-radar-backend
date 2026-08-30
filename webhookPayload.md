full payload { match: BarMatch, output?: GameOutput }

gex.Models.Db.BarMatch{
id	[...]
engine	[...]
gameVersion	[...]
startTime	[...]
map	[...]
mapName	[...]
fileName	[...]
startOffset	[...]
durationMs	[...]
durationFrameCount	[...]
gamemode	[...]
hostSettings	{...}
gameSettings	{...}
mapSettings	{...}
spadsSettings	{...}
restrictions	{...}
teams	[...]
allyTeams	[...]
players	[...]
spectators	[...]
aiPlayers	[...]
chatMessages	[...]
teamDeaths	[...]
playerLeaves	[...]
mapDraws	[...]
commands	[...]
playerCount	[...]
uploadedByID	[...]
wrongSkillValues	[...]
offlineGame	[...]
averageOS	[...]
minOS	[...]
maxOS	[...]
startSpotVersion	[...]
mapData	gex.Models.Bar.BarMap{...}
matchPoolEntryNote	[...]
matchPoolIsHidden	[...]
startRegionData	[...]
}
gex.Models.Event.GameOutput{
gameID	[...]
unitDefinitions	[...]
windUpdates	[...]
unitsCreated	[...]
unitsKilled	[...]
unitsTaken	[...]
unitsGiven	[...]
factoryUnitCreated	[...]
commanderPositionUpdates	[...]
extraStats	[...]
transportLoaded	[...]
transportUnloaded	[...]
teamDiedEvents	[...]
unitResources	[...]
unitDamage	[...]
unitPosition	[...]
teamStats	[...]
}
