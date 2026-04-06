"""
build_station_index.py

Generates data/weather/uk_stations.json from embedded UK TMYx.2011-2025
station data sourced from climate.onebuilding.org.

Usage:
    python scripts/build_station_index.py
"""

import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://climate.onebuilding.org/WMO_Region_6_Europe/GBR_United_Kingdom"

REGION_DIRS = {
    "ENG": "ENG_England",
    "SCT": "SCT_Scotland",
    "WAL": "WAL_Wales",
    "NIR": "NIR_Northern_Ireland",
}

# ---------------------------------------------------------------------------
# ENG stations — exact filename stems provided
# (wmo_id, name, lat, lon, elev_m, exact_stem)
# ---------------------------------------------------------------------------

ENG_STATIONS = [
    ("030180", "Woodvale",                        53.5820, -3.0560,  11, "Woodvale.030180"),
    ("032090", "Drumburgh",                       54.9330, -3.1500,   7, "Drumburgh.032090"),
    ("032100", "Sandwith-St.Bees.Head",           54.5178, -3.6147, 123, "Sandwith-St.Bees.Head.032100"),
    ("032110", "St.Bees.Head.Lighthouse",         54.5136, -3.6366,  94, "St.Bees.Head.Lighthouse.032110"),
    ("032120", "Keswick",                         54.6139, -3.1567,  81, "Keswick.032120"),
    ("032130", "Eskmeals",                        54.3170, -3.4000,   9, "Eskmeals.032130"),
    ("032140", "Walney Island AP",                54.1250, -3.2581,  14, "Walney.Island.AP.032140"),
    ("032145", "Warton",                          53.7450, -2.8830,  17, "Warton.032145"),
    ("032150", "Aspatria",                        54.7670, -3.3170,  62, "Aspatria.032150"),
    ("032200", "RAF Carlisle",                    54.9330, -2.9670,  27, "RAF.Carlisle.032200"),
    ("032220", "Carlisle Lake District AP",       54.9380, -2.8090,  58, "Carlisle.Lake.District.AP.032220"),
    ("032230", "Rydal",                           54.4500, -2.9830,  67, "Rydal.032230"),
    ("032240", "Spadeadam",                       55.0503, -2.5544, 286, "Spadeadam.032240"),
    ("032250", "Shap",                            54.5000, -2.6830, 255, "Shap.032250"),
    ("032260", "Warcop Range",                    54.5725, -2.4131, 227, "Warcop.Range.032260"),
    ("032270", "Great Dun Fell",                  54.6842, -2.4514, 847, "Great.Dun.Fell.032270"),
    ("032280", "Whins Pond Aux",                  54.6670, -2.7000, 125, "Whins.Pond.Aux.032280"),
    ("032300", "Redesdale Camp",                  55.2850, -2.2794, 212, "Redesdale.Camp.032300"),
    ("032350", "Boltshope Park",                  54.8170, -2.0830, 434, "Boltshope.Park.032350"),
    ("032380", "Albemarle-Ouston AF",             55.0197, -1.8817, 146, "Albemarle-Ouston.AF.032380"),
    ("032400", "Boulmer",                         55.4240, -1.6030,  21, "Boulmer.032400"),
    ("032410", "Long Framlington",                55.3000, -1.8000, 158, "Long.Framlington.032410"),
    ("032420", "Burnhope",                        54.8170, -1.7170, 244, "Burnhope.032420"),
    ("032433", "Newcastle Intl AP",               55.0380, -1.6920,  81, "Newcastle.Intl.AP.032433"),
    ("032460", "Newcastle Wea Centre",            54.9830, -1.6000,  52, "Newcastle.Wea.Centre.032460"),
    ("032570", "RAF Leeming",                     54.2920, -1.5350,  40, "RAF.Leeming.032570"),
    ("032610", "RAF Dishforth",                   54.1370, -1.4200,  36, "RAF.Dishforth.032610"),
    ("032620", "Tynemouth",                       55.0170, -1.4170,  30, "Tynemouth.032620"),
    ("032635", "Durham Tees Valley Intl AP",      54.5090, -1.4290,  37, "Durham.Tees.Valley.Intl.AP.032635"),
    ("032650", "Topcliffe",                       54.2000, -1.3830,  28, "Topcliffe.032650"),
    ("032660", "RAF Linton-on-Ouse",              54.0490, -1.2530,  16, "RAF.Linton-on-Ouse.032660"),
    ("032690", "Teesmouth",                       54.6500, -1.1330,  12, "Teesmouth.032690"),
    ("032710", "Teesmouth Aux",                   54.6200, -1.1300,  12, "Teesmouth.Aux.032710"),
    ("032750", "Loftus",                          54.5628, -0.8636, 159, "Loftus.032750"),
    ("032810", "Fylingdales",                     54.3590, -0.6720, 262, "Fylingdales.032810"),
    ("032820", "Whitby",                          54.4830, -0.6000,  60, "Whitby.032820"),
    ("032910", "Flamborough Head",                54.1170, -0.0830,  46, "Flamborough.Head.032910"),
    ("032920", "Bridlington MRSC",                54.0939, -0.1758,  19, "Bridlington.MRSC.032920"),
    ("033020", "Anglesey AP-RAF Valley",          53.2525, -4.5364,  11, "Anglesey.AP-RAF.Valley.033020"),
    ("033150", "Formby Dead",                     53.5500, -3.1000,   9, "Formby.Dead.033150"),
    ("033160", "Crosby",                          53.4972, -3.0578,   9, "Crosby.033160"),
    ("033180", "Blackpool AP",                    53.7740, -3.0390,  10, "Blackpool.AP.033180"),
    ("033190", "Fleetwood",                       53.9170, -3.0330,   8, "Fleetwood.033190"),
    ("033220", "Aughton",                         53.5500, -2.9170,  56, "Aughton.033220"),
    ("033233", "Liverpool Lennon AP",             53.3340, -2.8500,  24, "Liverpool.Lennon.AP.033233"),
    ("033290", "Winter Hill",                     53.6170, -2.5170, 440, "Winter.Hill.033290"),
    ("033300", "Leek-Thorncliffe",                53.1278, -1.9814, 299, "Leek-Thorncliffe.033300"),
    ("033340", "Manchester AP",                   53.3540, -2.2750,  78, "Manchester.AP.033340"),
    ("033350", "Manchester-Barton",               53.4830, -2.2500,  37, "Manchester-Barton.033350"),
    ("033380", "Cellarhead",                      53.0330, -2.0830, 228, "Cellarhead.033380"),
    ("033390", "Skipton",                         53.9670, -2.0330, 153, "Skipton.033390"),
    ("033400", "Holme Moss",                      53.5330, -1.8830, 522, "Holme.Moss.033400"),
    ("033430", "Huddersfield Oakes",              53.6500, -1.8330, 232, "Huddersfield.Oakes.033430"),
    ("033440", "Bingley",                         53.8113, -1.8668, 267, "Bingley.033440"),
    ("033450", "Emley Moor",                      53.6170, -1.6670, 259, "Emley.Moor.033450"),
    ("033460", "Shelley-Emley Moor",              53.6120, -1.6670, 267, "Shelley-Emley.Moor.033460"),
    ("033463", "Leeds Bradford AP",               53.8660, -1.6610, 208, "Leeds.Bradford.AP.033463"),
    ("033464", "Penzance Heliport",               50.1200, -5.5200,   4, "Penzance.Helo.033464"),
    ("033465", "Newquay Cornwall AP",             50.4330, -4.9830, 119, "Newquay-Cornwall.AP.033465"),
    ("033470", "Leeds Wea Ctr",                   53.8000, -1.5500,  47, "Leeds.Wea.Ctr.033470"),
    ("033480", "Woodford AP",                     53.3330, -2.1500,  88, "Woodford.AP.033480"),
    ("033510", "Rostherne",                       53.3670, -2.3830,  35, "Rostherne.No.033510"),
    ("033540", "Nottingham Watnall",              53.0056, -1.2511, 117, "Nottingham.Watnall.033540"),
    ("033550", "RAF Church Fenton",               53.8340, -1.1960,   9, "RAF.Church.Fenton.033550"),
    ("033723", "Barkston Heath RAF",              52.9620, -0.5620, 112, "Barkston.Heath.RAF.033723"),
    ("033730", "RAF Scampton",                    53.3069, -0.5481,  62, "RAF.Scampton.033730"),
    ("033735", "Humberside AP",                   53.5740, -0.3510,  37, "Humberside.AP.033735"),
    ("033770", "RAF Waddington",                  53.1753, -0.5233,  70, "RAF.Waddington.033770"),
    ("033790", "Cranwell AP",                     53.0311, -0.5036,  66, "Cranwell.AP.033790"),
    ("033820", "Leconfield AP",                   53.8747, -0.4417,   7, "Leconfield.AP.033820"),
    ("033850", "Donna Nook",                      53.4750,  0.1530,   8, "Donna.Nook.033850"),
    ("033851", "RAF Donna Nook",                  53.4750,  0.1520,   3, "RAF.Donna.Nook.033851"),
    ("033870", "Easington",                       53.6670,  0.1170,  10, "Easington.033870"),
    ("033880", "RAF Binbrook",                    53.4500, -0.2000, 108, "RAF.Binbrook.033880"),
    ("033900", "Inner Dowsing LH",                53.3330,  0.5670,  37, "Inner.Dowsing.Lh.033900"),
    ("033910", "RAF Coningsby",                   53.0939, -0.1728,   8, "RAF.Coningsby.033910"),
    ("033920", "Wainfleet",                       53.0883,  0.2708,   5, "Wainfleet.033920"),
    ("033940", "Gibraltar Point",                 53.1000,  0.3170,   4, "Gibraltar.Point.033940"),
    ("033960", "Spurn Head Point",                53.6170,  0.1500,  12, "Spurn.Head.Point.033960"),
    ("033980", "Humber Light Vessel",             53.6170,  0.3670,   5, "Humber.Lgt.Vsl.033980"),
    ("033990", "Dowsing Light",                   53.5670,  0.8330,   5, "Dowsing.Light.033990"),
    ("034010", "Porthdynllaen",                   52.9500, -4.5670,  37, "Porthdynllaen.034010"),
    ("034030", "Nantmor",                         53.0000, -4.0830,  53, "Nantmor.034030"),
    ("034054", "Doncaster Sheffield AP",          53.4750, -1.0040,  17, "Doncaster.Sheffield-Hood.AP.034054"),
    ("034070", "Llanbedr",                        52.8000, -4.1170,   9, "Llanbedr.034070"),
    ("034140", "RAF Shawbury",                    52.7947, -2.6647,  76, "RAF.Shawbury.034140"),
    ("034145", "Cosford",                         52.6400, -2.3060,  83, "Cosford.034145"),
    ("034180", "Ternhill RAF",                    52.8670, -2.5330,  83, "Ternhill.Raf.034180"),
    ("034185", "Nottingham East Midlands AP",     52.8310, -1.3280,  93, "Nottingham-East.Midlands.AP.034185"),
    ("034530", "RAF Cottesmore",                  52.7360, -0.6490, 140, "RAF.Cottesmore.034530"),
    ("034620", "RAF Wittering",                   52.6114, -0.4611,  83, "RAF.Wittering.034620"),
    ("034690", "Holbeach",                        52.8733,  0.1386,   3, "Holbeach.034690"),
    ("034700", "Holbeach RAF Range",              52.8830,  0.1830,  12, "Holbeach.Raf.Range.034700"),
    ("034820", "RAF Marham",                      52.6514,  0.5661,  23, "RAF.Marham.034820"),
    ("034870", "RAF Sculthorpe",                  52.8500,  0.7670,  65, "RAF.Sculthorpe.034870"),
    ("034880", "Weybourne",                       52.9494,  1.1225,  20, "Weybourne.034880"),
    ("034920", "Norwich Intl AP",                 52.6760,  1.2830,  36, "Norwich.Intl.AP.034920"),
    ("034940", "Cromer",                          52.9330,  1.3170,  44, "Cromer.034940"),
    ("034950", "RAF Coltishall",                  52.7550,  1.3580,  20, "RAF.Coltishall.034950"),
    ("034960", "Hemsby",                          52.6830,  1.6830,  14, "Hemsby.034960"),
    ("034970", "Gorleston",                       52.5830,  1.7170,   3, "Gorleston.034970"),
    ("034980", "Newarp Light Vessel",             52.8000,  1.8330,   5, "Newarp.Lgt.Vsl.034980"),
    ("035110", "Newcastle on Clun",               52.4330, -3.1170, 215, "Newcastle.on.Clun.035110"),
    ("035200", "Shobdon AF",                      52.2431, -2.8858,  99, "Shobdon.AF.035200"),
    ("035210", "Madley AP",                       52.0330, -2.8500,  78, "Madley.AP.035210"),
    ("035220", "Hereford Credenhill",             52.0800, -2.8025,  76, "Hereford.Credenhill.035220"),
    ("035260", "Barbourne",                       52.2000, -2.2170,  25, "Barbourne.035260"),
    ("035270", "Great Malvern",                   52.1170, -2.3000,  44, "Great.Malvern.035270"),
    ("035290", "Pershore AP",                     52.1483, -2.0411,  31, "Pershore.AP.035290"),
    ("035340", "Birmingham AP",                   52.4540, -1.7480, 100, "Birmingham.AP.035340"),
    ("035350", "Coleshill",                       52.4800, -1.6908,  96, "Coleshill.035350"),
    ("035410", "Coventry AP",                     52.3670, -1.4830,  85, "Coventry.AP.035410"),
    ("035440", "Church Lawford",                  52.3589, -1.3314, 106, "Church.Lawford.035440"),
    ("035573", "Cranfield AP",                    52.0720, -0.6170, 109, "Cranfield.AP.035573"),
    ("035590", "Cardington",                      52.1000, -0.4170,  29, "Cardington.035590"),
    ("035600", "RAF Bedford",                     52.2269, -0.4653,  84, "RAF.Bedford.035600"),
    ("035620", "RAF Alconbury",                   52.3670, -0.2170,  48, "RAF.Alconbury.035620"),
    ("035660", "Wyton AP",                        52.3570, -0.1080,  41, "Wyton.AP.035660"),
    ("035715", "Cambridge AP",                    52.2050,  0.1750,  14, "Cambridge.AP.035715"),
    ("035770", "RAF Mildenhall",                  52.3670,  0.4830,  10, "RAF.Mildenhall.035770"),
    ("035830", "RAF Lakenheath",                  52.4170,  0.5670,  10, "RAF.Lakenheath.035830"),
    ("035860", "RAF Honington",                   52.3330,  0.7670,  53, "RAF.Honington.035860"),
    ("035900", "Wattisham AF",                    52.1239,  0.9575,  87, "Wattisham.AF.035900"),
    ("035930", "Beccles",                         52.4330,  1.6170,  22, "Beccles.035930"),
    ("035951", "RAF Woodbridge",                  52.0830,  1.4000,  29, "RAF.Woodbridge.035951"),
    ("035961", "Bentwaters Park",                 52.1330,  1.4330,  26, "Bentwaters.Park.035961"),
    ("035980", "Aldeburgh",                       52.1500,  1.6000,   9, "Aldeburgh.035980"),
    ("035990", "RAF Wynton-Henlow Camp",          52.0170, -0.2670,  95, "RAF.Wynton-Henlow.Camp.035990"),
    ("036050", "Pembry Sands",                    51.7144, -4.3675,   3, "Pembry.Sands.036050"),
    ("036060", "Monkstone Point",                 51.7000, -4.6670,  84, "Monkstone.Pt.036060"),
    ("036080", "Pendine",                         51.7500, -4.5170,   5, "Pendine.036080"),
    ("036280", "Bristol-Filton AF",               51.5170, -2.5830,  59, "Bristol-Filton.AF.036280"),
    ("036330", "Gloucester",                      51.8670, -2.2170,  24, "Gloucester.036330"),
    ("036333", "Gloucestershire AP",              51.8940, -2.1670,  31, "Gloucestershire.AP.036333"),
    ("036380", "Kemble RAF",                      51.6670, -2.0500, 133, "Kemble.RAF.036380"),
    ("036440", "Fairford AF",                     51.6820, -1.7900,  87, "Fairford.AF.036440"),
    ("036470", "RAF Little Rissington",           51.8606, -1.6931, 210, "RAF.Little.Rissington.036470"),
    ("036490", "RAF Brize Norton",                51.7583, -1.5781,  88, "RAF.Brize.Norton.036490"),
    ("036553", "Upper Heyford AF",                51.9330, -1.2500, 133, "Upper.Heyford.AF.036553"),
    ("036580", "RAF Benson",                      51.6203, -1.0986,  69, "RAF.Benson.036580"),
    ("036584", "Colerne",                         51.4390, -2.2860, 181, "Colerne.036584"),
    ("036600", "High Wycombe",                    51.6817, -0.8069, 205, "High.Wycombe.036600"),
    ("036720", "RAF Northolt",                    51.5486, -0.4169,  38, "RAF.Northolt.036720"),
    ("036733", "London Luton AP",                 51.8750, -0.3680, 160, "London-Luton.AP.036733"),
    ("036740", "Chenies Auto",                    51.6830, -0.5330, 139, "Chenies.Auto.036740"),
    ("036800", "Rothamsted",                      51.8000,  0.4500, 128, "Rothamsted.036800"),
    ("036830", "London Stansted AP",              51.8850,  0.2350, 106, "London-Stansted.AP.036830"),
    ("036840", "Andrewsfield AF",                 51.8961,  0.4506,  87, "Andrewsfield.AF.036840"),
    ("036913", "London Southend AP",              51.5710,  0.6960,  15, "London-Southend.AP.036913"),
    ("036930", "Shoeburyness Landwick",           51.5547,  0.8269,   3, "Shoeburyness.Landwick.036930"),
    ("036950", "Thames Tower",                    51.6670,  1.1000,   8, "Thames.Tower.036950"),
    ("036960", "Walton on the Naze",              51.8510,  1.2670,   5, "Walton.on.the.Naze.036960"),
    ("036980", "Tongue Light",                    51.5170,  1.3830,  15, "Tongue.Light.036980"),
    ("037010", "Gawlish",                         51.0170, -4.5000, 122, "Gawlish.037010"),
    ("037020", "Lundy Island Lighthouse",         51.1620, -4.6560,  43, "Lundy.Island.Lighthouse.037020"),
    ("037030", "Hartland Point",                  51.0170, -4.5330,  91, "Hartland.Point.037030"),
    ("037040", "Hartland",                        50.9830, -4.4670, 142, "Hartland.037040"),
    ("037070", "RMB Chivenor",                    51.0892, -4.1486,   8, "RMB.Chivenor.037070"),
    ("037090", "Minehead",                        51.2000, -3.4500,  10, "Minehead.037090"),
    ("037100", "Liscombe",                        51.0869, -3.6089, 347, "Liscombe.037100"),
    ("037110", "Exton",                           51.0000, -3.4830, 332, "Exton.037110"),
    ("037120", "Tivington",                       51.2000, -3.5330,  83, "Tivington.037120"),
    ("037243", "Bristol AP",                      51.3830, -2.7190, 190, "Bristol.AP.037243"),
    ("037260", "Bristol Wea Ctr",                 51.4670, -2.6000,  11, "Bristol.Wea.Ctr.037260"),
    ("037400", "RAF Lyneham",                     51.5031, -1.9922, 156, "RAF.Lyneham.037400"),
    ("037430", "Larkhill",                        51.2017, -1.8058, 133, "Larkhill.037430"),
    ("037440", "Upavon",                          51.3000, -1.7670, 175, "Upavon.037440"),
    ("037450", "Netheravon Range",                51.2500, -1.7670, 139, "Netheravon.Ra.037450"),
    ("037460", "Boscombe Down AF",                51.1620, -1.7550, 124, "Boscombe.Down.AF.037460"),
    ("037490", "Middle Wallop AF",                51.1497, -1.5700,  91, "Middle.Wallop.AF.037490"),
    ("037610", "RAF Odiham",                      51.2389, -0.9450, 123, "RAF.Odiham.037610"),
    ("037630", "Bracknell Beaufort",              51.3830, -0.7830,  74, "Bracknell.Beaufort.037630"),
    ("037663", "London Biggin Hill AP",           51.3310,  0.0330, 182, "London-Biggin.Hill.AP.037663"),
    ("037670", "Liphook",                         51.0830, -0.8170,  98, "Liphook.037670"),
    ("037680", "Farnborough AP",                  51.2800, -0.7725,  72, "Farnborough.AP.037680"),
    ("037683", "London City AP",                  51.5050,  0.0550,   6, "London.City.AP.037683"),
    ("037690", "Charlwood",                       51.1440, -0.2290,  68, "Charlwood.037690"),
    ("037700", "London St James Park",            51.5049, -0.1310,   5, "London.Wea.Ctr-St.James.Park.037700"),
    ("037720", "London Heathrow Intl AP",         51.4792, -0.4506,  25, "London-Heathrow.Intl.AP.037720"),
    ("037750", "Kew Observatory",                 51.4670, -0.3170,   5, "Kew.Observatory.037750"),
    ("037760", "London Gatwick AP",               51.1480, -0.1900,  62, "London-Gatwick.AP.037760"),
    ("037810", "Kenley AF",                       51.3039, -0.0914, 170, "Kenley.AF.037810"),
    ("037815", "Leavesden",                       51.6830, -0.4170, 102, "Leavesden.037815"),
    ("037820", "Blackwall",                       51.5170,  0.0170,   5, "Blackwall.037820"),
    ("037840", "Gravesend Broadness",             51.4645,  0.3113,   3, "Gravesend.Broadness.037840"),
    ("037850", "Charing",                         51.2000,  0.7830,  91, "Charing.037850"),
    ("037860", "Gravesend",                       51.4330,  0.3830,   5, "Gravesend.037860"),
    ("037890", "Jubilee Corner",                  51.1830,  0.6330,  47, "Jubilee.Corner.037890"),
    ("037900", "East Malling",                    51.2830,  0.4500,  32, "East.Malling.037900"),
    ("037910", "Sheerness",                       51.4460,  0.7460,  25, "Sheerness.037910"),
    ("037920", "Doddington",                      51.2830,  0.7830,  91, "Doddington.037920"),
    ("037930", "Anvil Green",                     51.2000,  1.0170, 139, "Anvil.Green.037930"),
    ("037960", "Langdon Bay",                     51.1340,  1.3430, 117, "Langdon.Bay.037960"),
    ("037970", "Manston AP",                      51.3464,  1.3356,  54, "Manston.AP.037970"),
    ("037980", "Falls Light",                     51.3000,  1.8170,   5, "Falls.Light.037980"),
    ("037990", "East Goodwin Light",              51.2170,  1.6000,   5, "East.Goodwin.Light.037990"),
    ("038020", "Round Island Scilly",             49.9830, -6.3170,  38, "Round.Island-Scilly.038020"),
    ("038030", "St Marys AP Scilly",              49.9144, -6.2958,  31, "St.Marys.AP-Scilly.038030"),
    ("038040", "St Marys Scilly",                 49.9330, -6.3000,  51, "St.Marys-Scilly.038040"),
    ("038050", "Seven Stones LV",                 50.0500, -6.0670,   5, "Seven.Stones.L.V.038050"),
    ("038060", "Gwennap Head",                    50.0369, -5.6805,  63, "Gwennap.Head.038060"),
    ("038080", "Camborne",                        50.2183, -5.3275,  88, "Camborne.038080"),
    ("038090", "Culdrose AF",                     50.0844, -5.2572,  81, "Culdrose.AF.038090"),
    ("038100", "Falmouth-Pendennis Point",        50.1452, -5.0454,  42, "Falmouth-Pendennis.Point.038100"),
    ("038140", "Lizard Light",                    49.9500, -5.1830,  57, "Lizard.Light.038140"),
    ("038150", "Lizard Lighthouse",               49.9670, -5.2000,  60, "Lizard.Lighthouse.038150"),
    ("038200", "Davidstow Moor",                  50.6330, -4.6000, 291, "Davidstow.Moor.038200"),
    ("038230", "Cardinham-Bodmin AF",             50.5022, -4.6669, 199, "Cardinham-Bodmin.AF.038230"),
    ("038240", "Bastreet",                        50.5670, -4.4830, 238, "Bastreet.038240"),
    ("038270", "Plymouth Mount Batten",           50.3550, -4.1211,  27, "Plymouth-Mount.Batten.038270"),
    ("038273", "Plymouth AF",                     50.4230, -4.1060, 145, "Plymouth.AF.038273"),
    ("038300", "Burrington-Eaglescott AF",        50.9330, -3.9830, 199, "Burrington-Eaglescott.AF.038300"),
    ("038310", "North Hessary Tor",               50.5500, -4.0000, 510, "North.Hessary.Tor.038310"),
    ("038320", "Okehampton",                      50.7170, -4.0000, 372, "Okehampton.038320"),
    ("038330", "Chawleigh",                       50.9000, -3.8000, 160, "Chawleigh.038330"),
    ("038370", "Brixham",                         50.4000, -3.4830,   8, "Brixham.038370"),
    ("038390", "Exeter AP",                       50.7370, -3.4040,  31, "Exeter.AP.038390"),
    ("038400", "Dunkeswell AF",                   50.8603, -3.2403, 253, "Dunkeswell.AF.038400"),
    ("038450", "Beer",                            50.7000, -3.1000,  52, "Beer.038450"),
    ("038530", "Yeovilton AF",                    51.0064, -2.6428,  23, "Yeovilton.AF.038530"),
    ("038570", "Isle of Portland",                50.5218, -2.4573,  52, "Isle.of.Portland.038570"),
    ("038580", "Portland Heliport",               50.5650, -2.4490,   3, "Portland.Helo.038580"),
    ("038610", "Christchurch Bay",                50.7000, -1.6670,   7, "Christchurch.Bay.038610"),
    ("038620", "Bournemouth Intl AP",             50.7794, -1.8361,  12, "Bournemouth.Intl.AP.038620"),
    ("038630", "The Needles Cape",                50.6670, -1.5830,  86, "The.Needles.Cape.038630"),
    ("038650", "Southampton AP",                  50.9500, -1.3570,  13, "Southampton.AP.038650"),
    ("038660", "St Catherines Point IoW",         50.5756, -1.2969,  24, "St.Catherines.Point-Isle.of.Wight.038660"),
    ("038690", "Calshot",                         50.8170, -1.3000,   3, "Calshot.038690"),
    ("038720", "Thorney Island AF",               50.8147, -0.9225,   3, "Thorney.Island.AF.038720"),
    ("038730", "Totland",                         50.6830, -1.5330,  20, "Totland.038730"),
    ("038740", "Lee on Solent",                   50.8070, -1.2090,  13, "Lee.On.Solent.038740"),
    ("038750", "Wellow",                          50.6830, -1.4500,  25, "Wellow.038750"),
    ("038760", "Brighton City AP",                50.8361, -0.2936,   2, "Brighton.City.AP.038760"),
    ("038770", "East Hoathly",                    50.9170,  0.1500,  38, "East.Hoathly.038770"),
    ("038790", "Shoreham by Sea",                 50.8170, -0.2500,   5, "Shoreham.by.Sea.038790"),
    ("038800", "Newhaven Lighthouse",             50.7818,  0.0571,   5, "Newhaven.Lighthouse.038800"),
    ("038810", "Brede",                           50.9330,  0.6000,  82, "Brede.038810"),
    ("038820", "Herstmonceux-West End",           50.8910,  0.3165,  52, "Herstmonceux-West.End.038820"),
    ("038830", "Eastbourne",                      50.7830,  0.3000,   3, "Eastbourne.038830"),
    ("038840", "Herstmonceux Obs",                50.8700,  0.3466,  17, "Herstmonceux.Obs.038840"),
    ("038850", "Royal Sovereign Lighthouse",      50.7233,  0.4355,  23, "Royal.Sovereign.Lighthouse.038850"),
    ("038860", "Fairlight",                       50.8670,  0.6330, 143, "Fairlight.038860"),
    ("038873", "Lydd AP",                         50.9560,  0.9390,   4, "Lydd.AP.038873"),
    ("038880", "Dungeness",                       50.9170,  0.9670,   3, "Dungeness.038880"),
    ("038980", "Varne Light",                     51.0170,  1.4000,   5, "Varne.Light.038980"),
]

# ---------------------------------------------------------------------------
# SCT stations — filenames derived
# (wmo_id, name, lat, lon, elev_m)
# ---------------------------------------------------------------------------

SCT_STATIONS = [
    ("030010", "Muckle Flugga",               60.8552, -0.8854,  53),
    ("030020", "Baltasound AP",               60.7500, -0.8500,  15),
    ("030030", "Sumburgh AP",                 59.8790, -1.2960,   6),
    ("030040", "Collafirth Hill",             60.5330, -1.3830, 228),
    ("030050", "Lerwick",                     60.1330, -1.1830,  84),
    ("030060", "Sella Ness",                  60.4500, -1.2670,   7),
    ("030064", "Scatsta AP",                  60.4330, -1.2960,  25),
    ("030065", "Unst Island",                 60.7330, -0.8170, 285),
    ("030070", "Muckle Holm",                 60.5830, -1.2670,  20),
    ("030080", "Fair Isle AP",                59.5330, -1.6330,  57),
    ("030090", "North Ronaldsay AP",          59.3670, -2.4170,  11),
    ("030100", "Sule Skerry Lighthouse",      59.0846, -4.4020,  12),
    ("030110", "North Rona Island",           59.1170, -5.8170, 103),
    ("030130", "Foula",                       60.1500, -2.0670,  22),
    ("030140", "Foula AP",                    60.1170, -2.0670,  13),
    ("030170", "Kirkwall AP",                 58.9580, -2.9050,  16),
    ("030200", "Saint Kilda Island",          57.8170, -8.5670,   8),
    ("030210", "Lochboisdale",                57.1500, -7.3170,   6),
    ("030220", "Benbecula AP",                57.4810, -7.3630,   6),
    ("030230", "South Uist Range",            57.3575, -7.3850,   4),
    ("030240", "Hyskeir Lighthouse",          56.9670, -6.6830,  10),
    ("030250", "Butt of Lewis Lighthouse",    58.5170, -6.2670,  23),
    ("030260", "Stornoway AP",                58.2136, -6.3189,   8),
    ("030270", "Waterstein",                  57.4330, -6.7670,  83),
    ("030280", "Neist Point Lighthouse",      57.4230, -6.7880,  21),
    ("030290", "Ardnamurchan Lighthouse",     56.7330, -6.2170,  12),
    ("030310", "Loch Glascarnoch",            57.7250, -4.8956, 264),
    ("030330", "Diabaig",                     57.5830, -5.7000,  60),
    ("030340", "Aultbea",                     57.8589, -5.6328,  10),
    ("030350", "Barra Island AP",             57.0330, -7.4500,   3),
    ("030370", "Lusa Skye",                   57.2500, -5.8000,  18),
    ("030380", "Fort William",                56.8330, -5.1000,  20),
    ("030390", "Bealach Na Ba",               57.4181, -5.6886, 773),
    ("030400", "Kilmory",                     56.7670, -6.0500,  45),
    ("030410", "Aonach Mor",                  56.8220, -4.9690,1130),
    ("030440", "Altnaharra",                  58.2878, -4.4425,  80),
    ("030470", "Tulloch Bridge",              56.8669, -4.7081, 249),
    ("030490", "Cape Wrath Lighthouse",       58.6250, -5.0000, 112),
    ("030500", "Fort Augustus",               57.1330, -4.7170,  41),
    ("030540", "Strathy Point Lighthouse",    58.6000, -4.0170,  32),
    ("030550", "Rackwick",                    58.8670, -3.3830,  18),
    ("030570", "Foyers",                      57.2670, -4.4830,  21),
    ("030580", "Invergordon Harbour",         57.6830, -4.1670,   3),
    ("030590", "Inverness AP",                57.5430, -4.0480,   9),
    ("030600", "Tummel Bridge",               56.7000, -4.0170, 145),
    ("030610", "Tarbat Ness Cape",            57.8650, -3.7770,  18),
    ("030620", "Tain Range",                  57.8189, -3.9667,   4),
    ("030630", "Aviemore",                    57.2064, -3.8283, 228),
    ("030640", "Glenmore Lodge",              57.1670, -3.7000, 341),
    ("030650", "Cairngorm Summit",            57.1163, -3.6439,1245),
    ("030660", "RAF Kinloss",                 57.6456, -3.5636,   7),
    ("030670", "Fealar Lodge",                56.9000, -3.6330, 560),
    ("030680", "Lossiemouth AP",              57.7114, -3.3233,  13),
    ("030700", "Glenlivet",                   57.3500, -3.3500, 213),
    ("030710", "Grantown on Spey",            57.3330, -3.6330, 335),
    ("030720", "Cairnwell",                   56.8795, -3.4213, 933),
    ("030740", "Scrabster Harbour",           58.6170, -3.5500,  10),
    ("030750", "Wick AP",                     58.4539, -3.0900,  38),
    ("030770", "Lybster",                     58.3170, -3.2830,  85),
    ("030800", "Aboyne",                      57.0758, -2.8411, 140),
    ("030850", "Inchmarlo",                   57.0670, -2.5330,  80),
    ("030880", "Inverbervie",                 56.8519, -2.2658, 134),
    ("030900", "Windy Head",                  57.6330, -2.2330, 231),
    ("030910", "Aberdeen AP Dyce",            57.2050, -2.2053,  66),
    ("030920", "Peterhead Harbour",           57.5025, -1.7743,  15),
    ("030930", "Fraserburgh Lighthouse",      57.6980, -2.0030,  19),
    ("030940", "Rosehearty",                  57.7000, -2.1170,   7),
    ("031000", "Tiree AP",                    56.4999, -6.8807,  12),
    ("031020", "Rhins of Islay Lighthouse",   55.6730, -6.5130,  23),
    ("031050", "Islay Port Ellen",            55.6310, -6.1840,  17),
    ("031060", "Rhuvaal Islay",               55.9170, -6.1330,  20),
    ("031070", "Dhu Loch",                    55.8170, -5.1000,  83),
    ("031110", "Machrihanish-Campbeltown AP", 55.4408, -5.6969,  10),
    ("031140", "Oban",                        56.4170, -5.4670,   4),
    ("031160", "Dalmally Stronmilchan",       56.4000, -5.0000,  40),
    ("031180", "Corsewall Point Lighthouse",  55.0070, -5.1590,  15),
    ("031200", "Lochranza",                   55.7000, -5.3000,  46),
    ("031210", "Kildonan",                    55.4420, -5.1080,  18),
    ("031290", "Ardrossan",                   55.6500, -4.8170,   9),
    ("031310", "Mull of Galloway Lighthouse", 54.6350, -4.8570,  78),
    ("031320", "West Freugh AP",              54.8592, -4.9353,  12),
    ("031330", "Sloy",                        56.2500, -4.7170,   6),
    ("031340", "Glasgow Bishopton",           55.9067, -4.5325,  59),
    ("031350", "Glasgow Prestwick Intl AP",   55.5090, -4.5870,  20),
    ("031360", "Glasgow Prestwick RNAS",      55.5170, -4.5830,  27),
    ("031370", "Whithorn",                    54.7000, -4.4170,  40),
    ("031380", "Greenock MRCC",               55.9670, -4.8000,   5),
    ("031390", "Saughall",                    55.6000, -4.2170, 223),
    ("031400", "Glasgow AP",                  55.8720, -4.4330,   8),
    ("031430", "Killin",                      56.4830, -4.3500, 114),
    ("031440", "Strathallen AF",              56.3264, -3.7286,  35),
    ("031450", "Glasgow Wea Center",          55.8670, -4.2670,  17),
    ("031470", "Glenlee",                     55.1000, -4.1830,  55),
    ("031480", "Glenogle",                    56.4249, -4.3232, 564),
    ("031490", "Duncarron",                   56.0670, -4.0500, 335),
    ("031500", "Crawfordjohn",                55.5000, -3.7670, 274),
    ("031520", "Salsburgh",                   55.8670, -3.8670, 275),
    ("031530", "Dundrennan",                  54.8033, -4.0081, 113),
    ("031540", "Dumfries Drungans",           55.0500, -3.6500,  16),
    ("031550", "Drumalbin",                   55.6272, -3.7361, 245),
    ("031570", "Perth Scone",                 56.4330, -3.3670, 121),
    ("031580", "RAF Charterhall",             55.7086, -2.3847, 111),
    ("031600", "Edinburgh AP",                55.9500, -3.3730,  41),
    ("031610", "Eddleston",                   55.7000, -3.2170, 195),
    ("031620", "Eskdalemuir",                 55.3120, -3.2070, 242),
    ("031634", "Dundee AP",                   56.4520, -3.0260,   5),
    ("031660", "Edinburgh Gogarbank",         55.9283, -3.3444,  57),
    ("031670", "Bass Rock Lighthouse",        56.0830, -2.6330,  38),
    ("031680", "Galashiels",                  55.6000, -2.9000, 146),
    ("031700", "Shanwell",                    56.4330, -2.8670,   5),
    ("031710", "RAF Leuchars",                56.3770, -2.8630,  12),
    ("031740", "Fife Ness",                   56.2790, -2.5870,  12),
    ("031760", "Carterhouse",                 55.3670, -2.5170, 308),
    ("031770", "Bell Rock Lighthouse",        56.4330, -2.4000,  21),
    ("031850", "St Abbs Head Lighthouse",     55.9170, -2.1330,  75),
    ("035661", "Islay AP",                    55.6820, -6.2570,  17),
    ("GBR001", "Out Stack",                   60.8603, -0.8741,   1),
]

# ---------------------------------------------------------------------------
# WAL stations — filenames derived
# (wmo_id, name, lat, lon, elev_m)
# ---------------------------------------------------------------------------

WAL_STATIONS = [
    ("033010", "Mona AP",                       53.2600, -4.3761,  62),
    ("033030", "Amlwch",                        53.3830, -4.3670, 114),
    ("033050", "Capel Curig",                   53.0942, -3.9414, 215),
    ("033080", "Snowdon Natl Park",             53.0670, -4.0830,1065),
    ("033090", "Yspytty Ifan",                  53.0330, -3.7000, 262),
    ("033130", "Rhyl AP",                       53.2592, -3.5089,  76),
    ("033140", "Moel y Crio",                   53.2170, -3.2170, 263),
    ("033210", "Hawarden AP",                   53.1750, -2.9870,  14),
    ("034000", "Bardsey Island Lighthouse",     52.7500, -4.8000,  16),
    ("034020", "Mynydd Rhiw",                   52.8170, -4.6330, 253),
    ("034040", "Aberdovey",                     52.5500, -4.0670,  22),
    ("034050", "Aberdaron",                     52.7889, -4.7414,  94),
    ("034060", "Trawsfynydd",                   52.9330, -3.9330, 193),
    ("034080", "Cynwyd",                        52.9500, -3.4170, 227),
    ("034090", "Bala",                          52.9000, -3.5830, 163),
    ("034100", "Lake Vyrnwy",                   52.7572, -3.4653, 359),
    ("034110", "Aberhosan",                     52.5670, -3.7170, 244),
    ("035010", "Capel Dewi",                    52.4170, -4.0000,  92),
    ("035020", "Aberporth-West Wales AP",       52.1390, -4.5710, 134),
    ("035030", "Trawsgoed",                     52.3442, -3.9481,  62),
    ("035050", "Saint Harmon",                  52.3330, -3.4830, 279),
    ("035070", "Sennybridge",                   52.0633, -3.6147, 307),
    ("036030", "RAF Brawdy",                    51.8830, -5.1170, 111),
    ("036040", "Milford Haven Port Authority",  51.7000, -5.0500,  32),
    ("036090", "Mumbles Head",                  51.5656, -3.9817,  32),
    ("036095", "Swansea AP",                    51.6050, -4.0680,  91),
    ("036100", "Pencelli Aux",                  51.9170, -3.3170, 160),
    ("036110", "Brynamman",                     51.8170, -3.8670, 182),
    ("036120", "Trecastle",                     51.9500, -3.7000, 312),
    ("036130", "Cwmbargoed",                    51.7500, -3.3330, 372),
    ("036140", "Cilfynydd",                     51.6330, -3.3000, 194),
    ("036170", "Storey Arms",                   51.8670, -3.4830, 457),
    ("037000", "Saint Gowan LV",                51.5000, -5.0000,   5),
    ("037150", "Cardiff AP",                    51.3970, -3.3430,  67),
    ("037160", "St Athan AP",                   51.4053, -3.4408,  50),
    ("037170", "Cardiff Wea Ctr",               51.4830, -3.1830,  52),
]

# ---------------------------------------------------------------------------
# NIR stations — filenames derived
# (wmo_id, name, lat, lon, elev_m)
# ---------------------------------------------------------------------------

NIR_STATIONS = [
    ("039000", "Knockarevan",               54.4170, -8.0830,  50),
    ("039010", "Thomastown",                54.3330, -7.6000,  72),
    ("039020", "Corgary",                   54.4330, -8.0500, 145),
    ("039030", "Enniskillen AP",            54.3950, -7.6440,  47),
    ("039040", "Castlederg",                54.7071, -7.5775,  50),
    ("039050", "Carrigans",                 54.6670, -7.3170, 113),
    ("039060", "Carmoney",                  55.0170, -7.2330,  73),
    ("039070", "Magilligan",                55.1500, -6.9330,   6),
    ("039080", "Ballykelly AF",             55.0570, -7.0070,   5),
    ("039084", "Derry Londonderry AP",      55.0430, -7.1610,   7),
    ("039090", "Moneydig",                  54.9830, -6.6000,  34),
    ("039100", "Maghera",                   54.8500, -6.7000, 141),
    ("039110", "Lough Fea",                 54.7211, -6.8147, 227),
    ("039120", "Moyola",                    54.7170, -6.5170,  17),
    ("039140", "Portrush",                  55.2000, -6.6670,   8),
    ("039150", "Portglenone",               54.8653, -6.4583,  65),
    ("039160", "Ballypatrick Forest",       55.1806, -6.1547, 156),
    ("039170", "Belfast Intl AP",           54.6580, -6.2160,  82),
    ("039200", "Hillsborough AF",           54.4850, -6.0970,  38),
    ("039220", "Kilkeel",                   54.0500, -6.0000,  18),
    ("039230", "Glenanne",                  54.2369, -6.5039, 160),
    ("039240", "Belfast City AP",           54.6180, -5.8730,   5),
    ("039250", "Orlock Head",               54.6670, -5.5830,  34),
    ("039260", "Killough",                  54.2330, -5.6170,  18),
    ("039270", "Bangor Harbour",            54.6640, -5.6680,  11),
    ("039280", "Larne",                     54.8520, -5.8310,   3),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def derive_stem(name: str, wmo_id: str) -> str:
    """
    Derive the filename stem for SCT/WAL/NIR stations.

    Rules:
    - Strip parenthetical suffixes like " (Shetland)", " (Outer Hebrides)", etc.
    - Replace " / " with "-"
    - Replace spaces with "."
    - Append "." + wmo_id
    """
    # Strip parentheticals, e.g. " (Shetland)"
    clean = re.sub(r"\s*\([^)]*\)", "", name).strip()
    # Replace " / " with "-"
    clean = clean.replace(" / ", "-")
    # Replace remaining spaces with "."
    clean = clean.replace(" ", ".")
    return f"{clean}.{wmo_id}"


def make_download_url(filename: str, region: str) -> str:
    """Build the full download URL for a station zip file."""
    region_dir = REGION_DIRS[region]
    return f"{BASE_URL}/{region_dir}/{filename}"


def build_stations() -> list[dict]:
    stations = []

    # ENG — exact stems provided
    for wmo_id, name, lat, lon, elev_m, stem in ENG_STATIONS:
        filename = f"GBR_ENG_{stem}_TMYx.2011-2025.zip"
        stations.append({
            "name": name,
            "region": "ENG",
            "wmo_id": wmo_id,
            "latitude": lat,
            "longitude": lon,
            "elevation_m": elev_m,
            "filename": filename,
            "download_url": make_download_url(filename, "ENG"),
        })

    # SCT — derive stems
    for wmo_id, name, lat, lon, elev_m in SCT_STATIONS:
        stem = derive_stem(name, wmo_id)
        filename = f"GBR_SCT_{stem}_TMYx.2011-2025.zip"
        stations.append({
            "name": name,
            "region": "SCT",
            "wmo_id": wmo_id,
            "latitude": lat,
            "longitude": lon,
            "elevation_m": elev_m,
            "filename": filename,
            "download_url": make_download_url(filename, "SCT"),
        })

    # WAL — derive stems
    for wmo_id, name, lat, lon, elev_m in WAL_STATIONS:
        stem = derive_stem(name, wmo_id)
        filename = f"GBR_WAL_{stem}_TMYx.2011-2025.zip"
        stations.append({
            "name": name,
            "region": "WAL",
            "wmo_id": wmo_id,
            "latitude": lat,
            "longitude": lon,
            "elevation_m": elev_m,
            "filename": filename,
            "download_url": make_download_url(filename, "WAL"),
        })

    # NIR — derive stems
    for wmo_id, name, lat, lon, elev_m in NIR_STATIONS:
        stem = derive_stem(name, wmo_id)
        filename = f"GBR_NIR_{stem}_TMYx.2011-2025.zip"
        stations.append({
            "name": name,
            "region": "NIR",
            "wmo_id": wmo_id,
            "latitude": lat,
            "longitude": lon,
            "elevation_m": elev_m,
            "filename": filename,
            "download_url": make_download_url(filename, "NIR"),
        })

    return stations


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Resolve output path relative to this script's project root
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    output_path = project_root / "data" / "weather" / "uk_stations.json"

    output_path.parent.mkdir(parents=True, exist_ok=True)

    stations = build_stations()

    payload = {
        "source": "climate.onebuilding.org",
        "dataset": "TMYx.2011-2025",
        "country": "GBR",
        "generated_by": "scripts/build_station_index.py",
        "station_count": len(stations),
        "stations": stations,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(stations)} stations to {output_path}")


if __name__ == "__main__":
    main()
