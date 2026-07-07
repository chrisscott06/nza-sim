# Brief 16: Quick Fixes — Window Count, Parser, Sankey Layout

BEFORE DOING ANYTHING:
1. Read CLAUDE.md
2. Read STATUS.md
3. Read this ENTIRE brief before writing a single line of code
4. One part at a time. Verify in browser at 1440×900. Commit. Push.

---

## Context

Three bugs identified from testing. All are small, targeted fixes.

4 parts. Do them in order.

---

## PART 1: Fix window count resetting other facades

**File(s):** `frontend/src/context/ProjectContext.jsx`

**The bug:** When updating `window_count` for one facade, it replaces the entire `window_count` object instead of merging. Changing north windows to 6 wipes south/east/west back to defaults.

**Root cause:** `updateParam` on line 288 has special merge handling for `wwr` and `location` but NOT for `window_count`. It falls through to the generic `else` which replaces the whole value.

**Fix:** Add `window_count` to the merge list:

```js
const updateParam = useCallback((key, value) => {
  setParams(p => {
    let next
    if (key === 'wwr') {
      next = { ...p, wwr: { ...p.wwr, ...value } }
    } else if (key === 'window_count') {
      next = { ...p, window_count: { ...p.window_count, ...value } }
    } else if (key === 'location') {
      next = { ...p, location: { ...p.location, ...value } }
    } else {
      next = { ...p, [key]: value }
    }
    _scheduleSave('building', next)
    return next
  })
}, [currentProjectId])
```

**Also widen the left panel slightly:** Change the Building module left column from `w-64` (256px) to `w-72` (288px) to give more room for the WWR sliders and window count inputs. Update in `BuildingDefinition.jsx`.

**Commit message:** "Part 1: Fix window count merge — changing one facade no longer resets others, widen left panel"

**Verify:**
1. Navigate to /building
2. Set F1 windows to 12, F2 to 4, F3 to 10, F4 to 6
3. Go back and change F1 to 8 — F2, F3, F4 should KEEP their values (4, 10, 6)
4. Refresh the page — all values should persist
5. The left panel should have slightly more room for the sliders
6. Report: "Window count merge fixed. Tested: set F1=12, F2=4, F3=10, F4=6. Changed F1 to 8 — F2/F3/F4 unchanged. Persists through refresh. Left panel widened to w-72."

---

## PART 2: Fix consumption parser — multi-sheet Excel + long format detection

**File(s):** `api/parsers/consumption_parser.py`

**Three bugs to fix:**

**2a — Multi-sheet Excel: skip instruction sheets**

The parser reads the first sheet, which is often an "Instructions" or "README" sheet with no data. Port Pablo's `isMetaSheet()` logic:

```python
def _is_meta_sheet(name: str, df: pd.DataFrame) -> bool:
    """Detect instruction/meta sheets that don't contain consumption data."""
    meta_keywords = ['instruct', 'readme', 'info', 'meta', 'notes', 'help', 'about', 'template']
    if any(k in name.lower() for k in meta_keywords):
        return True
    if len(df) < 5:
        return True
    # Check if first 10 rows have fewer than 3 numeric values
    sample = df.head(10)
    numeric_count = sum(1 for col in sample.columns for val in sample[col] if isinstance(val, (int, float)) and not pd.isna(val))
    return numeric_count < 3
```

When reading Excel files, iterate through sheets and use the FIRST non-meta sheet:

```python
if fn_lower.endswith((".xlsx", ".xls")):
    xls = pd.ExcelFile(io.BytesIO(file_bytes))
    df = None
    for sheet_name in xls.sheet_names:
        candidate = pd.read_excel(xls, sheet_name=sheet_name, header=0)
        if not _is_meta_sheet(sheet_name, candidate):
            df = candidate
            break
    if df is None:
        raise ValueError("No data sheets found in Excel file")
```

**2b — Long format: handle ts_col == date_col**

When a single column like "Interval start datetime" scores high as BOTH a timestamp and a date column, the condition `scores["ts_col"] != scores["date_col"]` blocks the long-format path.

Fix: Check the actual data values. If the highest-scoring timestamp column contains time components (HH:MM), use it as `ts_col` for long-format parsing regardless of whether it also scored as `date_col`:

```python
# After scoring, check if the best ts_col actually contains timestamps with time
ts_col = scores["ts_col"]
if ts_col:
    sample_vals = df[ts_col].dropna().head(10)
    has_time = any(
        re.search(r'\d{2}:\d{2}', str(v)) for v in sample_vals
    )
    if has_time and scores["value_col"]:
        # This IS a long-format file, even if ts_col == date_col
        records, interval = _parse_long(df, ts_col, scores["value_col"])
        fmt = "long"
```

Put this check BEFORE the wide-format check, so the detection order becomes:
1. Check for wide format (10+ time columns in headers)
2. Check for long format (timestamp column with HH:MM values + value column)
3. Fall back to monthly

**2c — Column scoring: boost "Interval start datetime" and "Import from grid (kWh)"**

Add higher-scoring keywords to match Pablo's `scoreDateH` and `scoreEnergyH`:

```python
# Timestamp scoring — add these high-value patterns
ts_high_patterns = ["interval start", "datetime", "timestamp"]
for pattern in ts_high_patterns:
    if pattern in col_l:
        tss += 10  # very high score

# Energy scoring — add these
energy_high_patterns = ["import from grid", "import kwh", "total kwh"]
for pattern in energy_high_patterns:
    if pattern in col_l:
        vs += 10
if "kwh" in col_l:
    vs += 5
if "import" in col_l and "kwh" in col_l:
    vs += 8
```

**Commit message:** "Part 2: Fix parser — skip meta sheets, handle ts==date, boost column scoring"

**Verify:**
1. Upload the Ledian_2025.xlsx file (the one Chris provided)
2. It should:
   - Skip the "Instructions" sheet
   - Read "Ledian Phase 1 +2" sheet
   - Detect "Interval start datetime" as the timestamp column
   - Detect "Import from grid (kWh)" as the value column
   - Parse as long format with 60-minute (hourly) intervals
   - Return 8,760 records
3. **DATA CHECK:** Total kWh should be reasonable for a commercial building (hundreds of MWh)
4. Report: "Parser fixed. Ledian_2025.xlsx: skipped Instructions sheet, parsed 'Ledian Phase 1 +2'. Format: long. Interval: 60 min. Records: 8,760. Total: [X] MWh. Fuel: electricity."

---

## PART 3: Remove butterfly expand button, widen Sankey text

**File(s):** `frontend/src/components/modules/building/LiveResultsPanel.jsx`, `frontend/src/components/modules/building/GainsLossesChart.jsx`

**3a — Remove the expand/Sankey button** from the butterfly chart area in the right panel. The expanded Sankey overlay (from Brief 10) is still accessible from the "Energy Flow" toggle in the centre column — it doesn't need a second trigger in the right panel. Removing it frees up vertical space.

**3b — Energy Flow Sankey text visibility:** The labels on the left side of the fabric Sankey ("Heating 147 MWh", "Solar gains 407 MWh") are being clipped by the left edge. Fix by:
- Increasing the left margin/padding of the Sankey SVG
- Or reducing the Sankey node padding so there's more space for labels
- Or making labels right-aligned for left-side nodes so they sit inside the chart area

Check the `FabricSankey.jsx` — the d3-sankey layout's `nodeAlign` and `nodePadding` settings may need adjustment, and the SVG viewBox margin on the left side should be increased.

**Commit message:** "Part 3: Remove butterfly expand button, fix Sankey left-side label clipping"

**Verify:**
1. Navigate to /building — right panel should NOT have the expand/↗ button on the butterfly
2. Toggle to "Energy Flow" — the Sankey labels on the left should be fully visible
3. **SCREENSHOT:** Fabric Sankey with all labels readable
4. Report: "Expand button removed. Sankey labels: [all visible / still partially clipped]. Left margin [increased by Xpx]."

---

## PART 4: Quick regression test

1. Building module: window counts persist across facades ✓/✗
2. Building module: left panel slightly wider, sliders usable ✓/✗
3. Building module: Energy Flow Sankey labels visible ✓/✗
4. Building module: butterfly chart — no expand button ✓/✗
5. Consumption: upload Ledian_2025.xlsx — parses successfully ✓/✗
6. Consumption: monthly chart shows data ✓/✗
7. Systems: Sankey still working ✓/✗
8. Auto-simulation: still triggers ✓/✗
9. Zero console errors ✓/✗

**Commit message:** "Part 4: Regression test — all fixes verified"

---

## After all 4 parts are complete

Update STATUS.md. Push to GitHub.

Tell Chris: "Brief 16 complete. Window count fixed — changing one facade no longer resets others. Parser fixed — Ledian Excel file now parses correctly (skips Instructions sheet, detects long format, finds 8,760 hourly records). Sankey labels visible, expand button removed. Left panel widened for sliders."
