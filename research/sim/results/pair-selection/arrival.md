## Arrival: 500 ranked to Each 20 under the rule, then 200 Unrated; thurstone(noise=0.5), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 15.4s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 169 | 100.00% | 100.00% | 88.19% | 30.35 | 1355 | 3415 (17/20) | — (0/20) | — | — | 65.9% | 63.1% | 72.4% |
| undecided-least + BALD | 200 | 100.00% | 100.00% | 70.33% | 0.00 | 795 | 1450 | — (0/20) | — | — | 75.7% | 71.2% | 80.9% |
| undecided-least + BALD, Unrated by index | 200 | 100.00% | 100.00% | 70.20% | 0.00 | 795 | 1490 | — (0/20) | — | — | 75.6% | 71.4% | 80.5% |
| undecided-least + BALD, Unrated every other pair | 399 | 99.50% | 50.13% | 70.56% | 0.00 | 800 | 1470 | — (0/20) | — | — | 76.0% | 74.4% | 81.2% |
| undecided-least + μ-proximity | 200 | 100.00% | 100.00% | 80.19% | 0.00 | 965 | 1610 | — (2/20) | 19.4 | 0.00% | 81.3% | 69.8% | 86.2% |
| undecided-least + μ-proximity, Unrated by index | 200 | 100.00% | 100.00% | 79.75% | 0.00 | 955 | 1615 | — (2/20) | 22.4 | 0.56% | 81.2% | 69.7% | 86.2% |
| undecided-least + μ-proximity, Unrated every other pair | 399 | 99.75% | 50.13% | 82.12% | 0.00 | 990 | 1670 | — (5/20) | 19.8 | 0.22% | 81.5% | 76.9% | 85.8% |
| lsa + lookahead | 200 | 100.00% | 100.00% | 73.63% | 0.00 | 1235 | 1585 | — (6/20) | 25.0 | 0.46% | 77.0% | 25.9% | 87.4% |
| lsa + lookahead, Unrated by index | 232 | 100.00% | 85.60% | 74.51% | 0.00 | 1170 | 1645 | — (4/20) | 22.9 | 0.83% | 77.3% | 33.5% | 85.4% |
| lsa + lookahead, Unrated every other pair | 399 | 99.57% | 50.13% | 73.73% | 0.00 | 1155 | 1625 | — (3/20) | 24.1 | 0.37% | 76.5% | 33.3% | 83.9% |
| undecided-least + BALD, Unrated may meet Unrated | 100 | 100.00% | 100.00% | 70.02% | 100.00 | 790 | 1480 | — (0/20) | — | — | 75.9% | 67.0% | 81.0% |

## Arrival: 500 ranked to Each 20 under the rule, then 50 Unrated; thurstone(noise=0.5), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 13.4s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 46 | 100.00% | 100.00% | 33.82% | 3.25 | 330 | 955 (19/20) | — (0/20) | — | — | 65.9% | 64.8% | 76.6% |
| undecided-least + BALD | 50 | 100.00% | 100.00% | 26.67% | 0.00 | 190 | 340 | — (3/20) | 32.7 | 0.00% | 75.7% | 74.1% | 82.7% |
| undecided-least + BALD, Unrated by index | 50 | 100.00% | 100.00% | 26.84% | 0.00 | 190 | 365 | — (0/20) | — | — | 75.6% | 74.2% | 83.2% |
| undecided-least + BALD, Unrated every other pair | 99 | 97.98% | 50.51% | 26.88% | 0.00 | 200 | 370 | — (0/20) | — | — | 76.0% | 75.5% | 83.3% |
| undecided-least + μ-proximity | 50 | 100.00% | 100.00% | 37.08% | 0.00 | 230 | 390 | 3350 (12/20) | 19.5 | 0.00% | 81.3% | 78.4% | 85.8% |
| undecided-least + μ-proximity, Unrated by index | 50 | 100.00% | 100.00% | 37.21% | 0.00 | 245 | 395 | 3175 (13/20) | 22.2 | 0.00% | 81.2% | 77.9% | 86.1% |
| undecided-least + μ-proximity, Unrated every other pair | 99 | 98.99% | 50.51% | 37.91% | 0.00 | 285 | 470 | 3790 (10/20) | 16.9 | 0.00% | 81.5% | 79.6% | 86.6% |
| lsa + lookahead | 50 | 100.00% | 100.00% | 36.96% | 0.00 | 330 | 465 | 1725 (18/20) | 22.7 | 0.49% | 77.0% | 41.7% | 86.6% |
| lsa + lookahead, Unrated by index | 60 | 100.00% | 81.97% | 35.29% | 0.00 | 320 | 490 | 3140 (13/20) | 25.8 | 0.51% | 77.3% | 45.9% | 86.1% |
| lsa + lookahead, Unrated every other pair | 99 | 98.28% | 50.51% | 35.55% | 0.00 | 340 | 440 | 3980 (11/20) | 22.0 | 0.40% | 76.5% | 47.8% | 86.2% |
| undecided-least + BALD, Unrated may meet Unrated | 25 | 100.00% | 100.00% | 27.13% | 25.00 | 195 | 345 | — (3/20) | 28.3 | 0.00% | 75.9% | 73.3% | 83.0% |

## Arrival: 500 ranked to Each 20 under the rule, then 200 Unrated; thurstone(noise=1), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 15.3s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 170 | 100.00% | 100.00% | 88.18% | 30.15 | 1610 | 4495 (13/20) | — (0/20) | — | — | 62.6% | 60.4% | 69.1% |
| undecided-least + BALD | 200 | 100.00% | 100.00% | 70.77% | 0.00 | 800 | 1350 | — (0/20) | — | — | 79.8% | 70.9% | 86.3% |
| undecided-least + BALD, Unrated by index | 200 | 100.00% | 100.00% | 70.31% | 0.00 | 810 | 1395 | — (1/20) | 27.7 | 3.33% | 80.4% | 71.3% | 86.6% |
| undecided-least + BALD, Unrated every other pair | 399 | 99.50% | 50.13% | 70.38% | 0.00 | 810 | 1415 | — (1/20) | 27.5 | 3.33% | 79.9% | 75.2% | 86.0% |
| undecided-least + μ-proximity | 200 | 100.00% | 100.00% | 81.31% | 0.00 | 1210 | 2200 | — (0/20) | — | — | 76.0% | 69.4% | 81.0% |
| undecided-least + μ-proximity, Unrated by index | 200 | 100.00% | 100.00% | 80.55% | 0.00 | 1175 | 2130 | — (0/20) | — | — | 74.9% | 68.4% | 80.9% |
| undecided-least + μ-proximity, Unrated every other pair | 399 | 99.75% | 50.13% | 81.15% | 0.00 | 1180 | 2280 | — (0/20) | — | — | 75.4% | 70.9% | 80.9% |
| lsa + lookahead | 200 | 100.00% | 100.00% | 73.56% | 0.00 | 1650 | 3535 | — (0/20) | — | — | 58.1% | 26.5% | 74.3% |
| lsa + lookahead, Unrated by index | 234 | 100.00% | 85.84% | 73.48% | 0.00 | 1595 | 3040 | — (0/20) | — | — | 60.0% | 27.9% | 72.0% |
| lsa + lookahead, Unrated every other pair | 399 | 99.59% | 50.13% | 73.37% | 0.00 | 1440 | 2960 (19/20) | — (0/20) | — | — | 58.0% | 28.4% | 74.3% |
| undecided-least + BALD, Unrated may meet Unrated | 100 | 100.00% | 100.00% | 70.26% | 100.00 | 795 | 1340 | — (1/20) | 27.6 | 2.78% | 80.7% | 59.0% | 87.0% |

## Arrival: 500 ranked to Each 20 under the rule, then 50 Unrated; thurstone(noise=1), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 13.7s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 47 | 100.00% | 100.00% | 33.85% | 2.85 | 425 | 2160 (17/20) | — (0/20) | — | — | 62.6% | 61.6% | 73.4% |
| undecided-least + BALD | 50 | 100.00% | 100.00% | 29.71% | 0.00 | 200 | 330 | — (9/20) | 30.6 | 1.98% | 79.8% | 76.7% | 87.4% |
| undecided-least + BALD, Unrated by index | 50 | 100.00% | 100.00% | 30.09% | 0.00 | 205 | 330 | 3865 (12/20) | 28.2 | 1.67% | 80.4% | 76.9% | 87.2% |
| undecided-least + BALD, Unrated every other pair | 99 | 97.98% | 50.51% | 30.23% | 0.00 | 205 | 345 | 3470 (13/20) | 26.2 | 2.91% | 79.9% | 78.2% | 86.7% |
| undecided-least + μ-proximity | 50 | 100.00% | 100.00% | 32.05% | 0.00 | 290 | 515 | — (6/20) | 22.5 | 1.48% | 76.0% | 73.6% | 84.2% |
| undecided-least + μ-proximity, Unrated by index | 50 | 100.00% | 100.00% | 33.21% | 0.00 | 315 | 665 | — (5/20) | 19.3 | 1.78% | 74.9% | 72.8% | 83.4% |
| undecided-least + μ-proximity, Unrated every other pair | 99 | 98.99% | 50.51% | 33.31% | 0.00 | 335 | 615 | — (5/20) | 26.4 | 0.89% | 75.4% | 73.2% | 84.1% |
| lsa + lookahead | 50 | 100.00% | 100.00% | 29.17% | 0.00 | 470 | 1230 | — (2/20) | 25.9 | 0.00% | 58.1% | 34.0% | 75.2% |
| lsa + lookahead, Unrated by index | 57 | 100.00% | 86.28% | 28.22% | 0.00 | 425 | 1165 | — (1/20) | 28.8 | 0.00% | 60.0% | 35.0% | 74.3% |
| lsa + lookahead, Unrated every other pair | 99 | 98.48% | 50.51% | 29.34% | 0.00 | 425 | 1095 | — (1/20) | 21.8 | 2.22% | 58.0% | 33.1% | 76.6% |
| undecided-least + BALD, Unrated may meet Unrated | 25 | 100.00% | 100.00% | 28.83% | 25.00 | 200 | 330 | 3740 (11/20) | 28.6 | 2.83% | 80.7% | 71.9% | 88.4% |

## Arrival: 500 ranked to Each 20 under the rule, then 200 Unrated; bradley-terry(noise=0.5), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 15.4s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 169 | 100.00% | 100.00% | 88.33% | 30.20 | 1390 | 3795 (18/20) | — (0/20) | — | — | 65.7% | 62.5% | 72.4% |
| undecided-least + BALD | 200 | 100.00% | 100.00% | 70.25% | 0.00 | 800 | 1475 | — (0/20) | — | — | 75.7% | 71.4% | 80.8% |
| undecided-least + BALD, Unrated by index | 200 | 100.00% | 100.00% | 70.57% | 0.00 | 795 | 1475 | — (0/20) | — | — | 76.0% | 71.5% | 81.1% |
| undecided-least + BALD, Unrated every other pair | 399 | 99.50% | 50.13% | 70.22% | 0.00 | 795 | 1430 | — (0/20) | — | — | 76.1% | 74.2% | 80.9% |
| undecided-least + μ-proximity | 200 | 100.00% | 100.00% | 80.28% | 0.00 | 1005 | 1760 | — (1/20) | 17.9 | 0.00% | 81.1% | 69.1% | 86.0% |
| undecided-least + μ-proximity, Unrated by index | 200 | 100.00% | 100.00% | 80.84% | 0.00 | 1005 | 1670 | — (0/20) | — | — | 80.7% | 69.1% | 86.2% |
| undecided-least + μ-proximity, Unrated every other pair | 399 | 99.75% | 50.13% | 79.84% | 0.00 | 985 | 1655 | — (3/20) | 22.8 | 0.00% | 81.3% | 76.2% | 86.2% |
| lsa + lookahead | 200 | 100.00% | 100.00% | 74.03% | 0.00 | 1175 | 1545 | — (7/20) | 25.8 | 0.32% | 79.2% | 27.9% | 86.9% |
| lsa + lookahead, Unrated by index | 237 | 100.00% | 84.00% | 73.71% | 0.00 | 1245 | 1700 | — (8/20) | 21.8 | 0.28% | 76.9% | 30.0% | 86.8% |
| lsa + lookahead, Unrated every other pair | 399 | 99.55% | 50.13% | 74.41% | 0.00 | 1195 | 1640 | — (7/20) | 25.1 | 0.40% | 79.1% | 33.6% | 85.4% |
| undecided-least + BALD, Unrated may meet Unrated | 100 | 100.00% | 100.00% | 70.32% | 100.00 | 790 | 1445 | — (0/20) | — | — | 75.8% | 67.5% | 81.0% |

## Arrival: 500 ranked to Each 20 under the rule, then 50 Unrated; bradley-terry(noise=0.5), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 13.7s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 47 | 100.00% | 100.00% | 33.96% | 2.90 | 360 | 1080 (19/20) | — (0/20) | — | — | 65.7% | 64.5% | 76.1% |
| undecided-least + BALD | 50 | 100.00% | 100.00% | 27.07% | 0.00 | 190 | 350 | — (4/20) | 29.0 | 0.00% | 75.7% | 74.2% | 82.7% |
| undecided-least + BALD, Unrated by index | 50 | 100.00% | 100.00% | 27.17% | 0.00 | 195 | 355 | — (3/20) | 30.4 | 0.00% | 76.0% | 74.6% | 83.2% |
| undecided-least + BALD, Unrated every other pair | 99 | 97.98% | 50.51% | 27.26% | 0.00 | 195 | 350 | — (3/20) | 33.5 | 0.74% | 76.1% | 75.5% | 83.0% |
| undecided-least + μ-proximity | 50 | 100.00% | 100.00% | 39.71% | 0.00 | 270 | 410 | 2975 (13/20) | 18.5 | 0.34% | 81.1% | 77.9% | 85.9% |
| undecided-least + μ-proximity, Unrated by index | 50 | 100.00% | 100.00% | 38.55% | 0.00 | 260 | 430 | 4025 (11/20) | 20.7 | 0.61% | 80.7% | 78.3% | 86.7% |
| undecided-least + μ-proximity, Unrated every other pair | 99 | 98.99% | 50.51% | 37.36% | 0.00 | 285 | 490 | 3860 (12/20) | 23.5 | 0.19% | 81.3% | 79.0% | 86.7% |
| lsa + lookahead | 50 | 100.00% | 100.00% | 36.13% | 0.00 | 355 | 470 | 2545 (14/20) | 27.7 | 0.32% | 79.2% | 44.5% | 86.8% |
| lsa + lookahead, Unrated by index | 61 | 100.00% | 81.30% | 36.81% | 0.00 | 320 | 530 | 1820 (15/20) | 20.9 | 0.74% | 76.9% | 47.0% | 86.2% |
| lsa + lookahead, Unrated every other pair | 99 | 98.23% | 50.51% | 36.56% | 0.00 | 345 | 515 | 2205 (14/20) | 23.2 | 0.79% | 79.1% | 47.0% | 87.2% |
| undecided-least + BALD, Unrated may meet Unrated | 25 | 100.00% | 100.00% | 26.87% | 25.00 | 190 | 325 | — (0/20) | — | — | 75.8% | 73.6% | 83.1% |

## Arrival: 500 ranked to Each 20 under the rule, then 200 Unrated; bradley-terry(noise=1), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 15.6s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 171 | 100.00% | 100.00% | 88.28% | 28.15 | 1710 | 4835 (13/20) | — (0/20) | — | — | 63.0% | 60.0% | 69.0% |
| undecided-least + BALD | 200 | 100.00% | 100.00% | 70.84% | 0.00 | 820 | 1370 | — (0/20) | — | — | 80.4% | 70.9% | 86.1% |
| undecided-least + BALD, Unrated by index | 200 | 100.00% | 100.00% | 70.64% | 0.00 | 805 | 1375 | — (1/20) | 28.3 | 1.67% | 80.2% | 71.1% | 86.3% |
| undecided-least + BALD, Unrated every other pair | 399 | 99.50% | 50.13% | 70.35% | 0.00 | 815 | 1360 | — (1/20) | 26.0 | 1.67% | 80.0% | 76.4% | 86.1% |
| undecided-least + μ-proximity | 200 | 100.00% | 100.00% | 80.35% | 0.00 | 1235 | 2180 | — (0/20) | — | — | 75.3% | 69.3% | 81.4% |
| undecided-least + μ-proximity, Unrated by index | 200 | 100.00% | 100.00% | 80.91% | 0.00 | 1185 | 2155 | — (0/20) | — | — | 75.4% | 68.1% | 81.2% |
| undecided-least + μ-proximity, Unrated every other pair | 399 | 99.75% | 50.13% | 80.29% | 0.00 | 1195 | 2075 | — (0/20) | — | — | 75.6% | 71.3% | 80.9% |
| lsa + lookahead | 200 | 100.00% | 100.00% | 74.55% | 0.00 | 1595 | 3300 | — (0/20) | — | — | 59.2% | 27.2% | 74.4% |
| lsa + lookahead, Unrated by index | 229 | 100.00% | 86.30% | 73.43% | 0.00 | 1580 | 2670 | — (0/20) | — | — | 59.2% | 27.4% | 74.2% |
| lsa + lookahead, Unrated every other pair | 399 | 99.60% | 50.13% | 73.87% | 0.00 | 1495 | 2795 | — (0/20) | — | — | 54.1% | 27.5% | 71.2% |
| undecided-least + BALD, Unrated may meet Unrated | 100 | 100.00% | 100.00% | 70.46% | 100.00 | 805 | 1355 | — (1/20) | 28.4 | 1.67% | 80.2% | 59.3% | 86.4% |

## Arrival: 500 ranked to Each 20 under the rule, then 50 Unrated; bradley-terry(noise=1), k = 2.5

Votes counted from the scan (median; (reached/runs) when not all). "All Scored": votes until every arrival has a Score. "With an arrival": share of votes showing at least one arrival, while any arrival is Unrated / from the scan until the arrivals are 90% Decided (or the end). "U-vs-U": votes pairing two Unrated arrivals, mean per run. "New Each" is the arrivals' mean Comparisons at the 90% point. Old: the old wallpapers' Decided share at the scan, its lowest point between the scan and the arrivals reaching 90% (or the end of 5000 votes), and at that point, means over runs. 20 libraries per row. 13.6s.

| Selector | All Scored | With an arrival, any Unrated | With an Unrated arrival | until 90% | U-vs-U | New 50% | 70% | 90% | New Each at 90% | Wrong among new at 90% | Old at scan | Old lowest | Old at new 90% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline (select_pair) | 47 | 100.00% | 100.00% | 33.92% | 2.90 | 375 | 935 (18/20) | — (0/20) | — | — | 63.0% | 61.9% | 73.6% |
| undecided-least + BALD | 50 | 100.00% | 100.00% | 30.18% | 0.00 | 210 | 330 | 3590 (13/20) | 30.0 | 2.74% | 80.4% | 76.9% | 87.5% |
| undecided-least + BALD, Unrated by index | 50 | 100.00% | 100.00% | 30.16% | 0.00 | 200 | 340 | 3760 (13/20) | 27.4 | 1.88% | 80.2% | 76.0% | 86.6% |
| undecided-least + BALD, Unrated every other pair | 99 | 97.98% | 50.51% | 29.40% | 0.00 | 205 | 330 | 4050 (11/20) | 29.7 | 2.83% | 80.0% | 78.8% | 87.2% |
| undecided-least + μ-proximity | 50 | 100.00% | 100.00% | 33.73% | 0.00 | 340 | 570 | — (6/20) | 18.9 | 2.22% | 75.3% | 73.2% | 83.7% |
| undecided-least + μ-proximity, Unrated by index | 50 | 100.00% | 100.00% | 33.19% | 0.00 | 290 | 565 | — (6/20) | 23.4 | 1.48% | 75.4% | 72.4% | 83.1% |
| undecided-least + μ-proximity, Unrated every other pair | 99 | 98.99% | 50.51% | 30.77% | 0.00 | 275 | 470 | — (4/20) | 24.0 | 3.33% | 75.6% | 73.4% | 84.4% |
| lsa + lookahead | 50 | 100.00% | 100.00% | 29.35% | 0.00 | 435 | 1325 (19/20) | — (1/20) | 31.3 | 0.00% | 59.2% | 36.0% | 79.8% |
| lsa + lookahead, Unrated by index | 60 | 100.00% | 83.68% | 29.74% | 0.00 | 455 | 1530 (19/20) | — (1/20) | 31.9 | 0.00% | 59.2% | 35.3% | 77.6% |
| lsa + lookahead, Unrated every other pair | 99 | 98.54% | 50.51% | 27.32% | 0.00 | 400 | 805 | — (0/20) | — | — | 54.1% | 32.3% | 78.8% |
| undecided-least + BALD, Unrated may meet Unrated | 25 | 100.00% | 100.00% | 28.50% | 25.00 | 195 | 330 | 4770 (11/20) | 32.2 | 1.62% | 80.2% | 72.7% | 87.6% |

