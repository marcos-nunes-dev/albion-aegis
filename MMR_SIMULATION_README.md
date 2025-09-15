# MMR Battle Simulation Tool

## Overview

The MMR Battle Simulation Tool (`mmr:simulate`) is a comprehensive testing and analysis command that simulates the entire MMR battle processing flow without saving any data to the database. This allows you to test, analyze, and iterate on the MMR system with detailed logging and results.

## Features

- **Complete Flow Simulation**: Simulates the entire MMR processing pipeline from battle discovery to final calculation
- **Detailed Logging**: Comprehensive logging of every step in the process
- **Participation Analysis**: Detailed analysis of guild participation criteria
- **Factor Breakdown**: Complete breakdown of all 10 MMR calculation factors
- **Anti-Farming Analysis**: Shows anti-farming factor calculations
- **Alliance Analysis**: Displays alliance relationships and friend groups
- **No Database Impact**: Safe to run multiple times without affecting production data

## Usage

### Basic Usage

```bash
yarn mmr:simulate <battleId>
```

### Advanced Usage with Options

```bash
yarn mmr:simulate <battleId> [options]
```

### Available Options

| Option | Short | Description |
|--------|-------|-------------|
| `--verbose` | `-v` | Show detailed guild information |
| `--participation` | `-p` | Show detailed participation analysis |
| `--factors` | `-f` | Show detailed factor breakdown |
| `--anti-farming` | `-a` | Show anti-farming details |
| `--alliances` | `-l` | Show alliance details |
| `--all` | | Enable all detailed options |

### Examples

```bash
# Basic simulation
yarn mmr:simulate 1268814359

# Verbose output with factor breakdown
yarn mmr:simulate 1268814359 --verbose --factors

# Complete detailed analysis
yarn mmr:simulate 1268814359 --all

# Specific analysis types
yarn mmr:simulate 1268814359 --participation --anti-farming
```

## Output Sections

### 1. Battle Overview
- Battle ID, total players, total fame
- MMR criteria validation (25+ players, 2M+ fame)
- Battle timing and duration

### 2. Battle Analysis
- Season information
- Guild statistics overview
- Prime time status
- Friend group detection

### 3. Participation Analysis
- Detailed participation criteria for each guild
- Fame, kills/deaths, and player participation ratios
- Eligibility determination
- Special rules for single players and small guilds

### 4. MMR Calculation Results
- Final MMR changes for each eligible guild
- Current vs new MMR values
- Anti-farming factors (if applicable)

### 5. Factor Breakdown (with --factors flag)
- All 10 weighted factors and their values
- Individual factor contributions
- Total weighted score calculation

### 6. Summary Statistics
- Total guilds vs eligible guilds
- Average MMR changes
- Battle characteristics

## Understanding the Output

### Participation Criteria

The simulation shows detailed participation analysis for each guild:

```
📊 GuildName:
   Status: ✅ ELIGIBLE / ❌ EXCLUDED
   Fame: 1,234,567 (15.2%) - ✅
   K/D: 8 (12.5%) - ✅
   Players: 3 (8.8%) - ❌
   Special: Small Guild
```

**Criteria Requirements:**
- **Fame**: ≥15% of total battle fame OR ≥1M fame
- **Kills/Deaths**: ≥15% of total kills+deaths OR ≥12 combined
- **Players**: ≥15% of total players OR ≥2 players
- **Special Rules**: Single players and small guilds have stricter requirements

### Factor Breakdown

When using `--factors` flag, you'll see detailed factor analysis:

```
🎯 GuildName Factor Breakdown:
   Total MMR Change: +12.45
   Individual Factors:
     winLoss: 1.000 (weight: 35%, contribution: 0.350)
     fame: 0.250 (weight: 15%, contribution: 0.038)
     playerCount: -0.600 (weight: 25%, contribution: -0.150)
     ...
   Total Weighted Score: 0.389
```

**10 MMR Factors:**
1. **Win/Loss (35%)**: Alliance-aware win/loss determination
2. **Player Count Advantage (25%)**: Penalties for numerical advantages
3. **Fame Differential (15%)**: Fame gained vs lost ratio
4. **Opponent Strength (15%)**: Based on enemy MMR vs own MMR
5. **Individual Performance (5%)**: Within alliance performance
6. **IP Level (5%)**: Item Power advantage/disadvantage
7. **Battle Size (5%)**: Battle scale factor
8. **K/D Ratio (5%)**: Kill to death ratio performance
9. **Battle Duration (3%)**: Quick wins vs long battles
10. **Kill Clustering (2%)**: Kill timing and coordination

### Anti-Farming Analysis

Shows how repeated wins against the same opponents are penalized:

```
Anti-farming Factor: 0.750
Original MMR Change: +16.60
Final MMR Change: +12.45
```

## Use Cases

### 1. Testing MMR Improvements
Run the simulation multiple times with different battle IDs to test how changes affect MMR calculations:

```bash
yarn mmr:simulate 1268814359 --all
yarn mmr:simulate 1268814360 --all
yarn mmr:simulate 1268814361 --all
```

### 2. Analyzing Specific Battles
Use detailed flags to understand why certain guilds were included/excluded:

```bash
yarn mmr:simulate 1268814359 --participation --factors
```

### 3. Validating Participation Criteria
Check if participation thresholds are working correctly:

```bash
yarn mmr:simulate 1268814359 --participation
```

### 4. Testing Anti-Farming System
Analyze how anti-farming affects repeated wins:

```bash
yarn mmr:simulate 1268814359 --anti-farming
```

### 5. Alliance Analysis
Understand how alliances affect MMR calculations:

```bash
yarn mmr:simulate 1268814359 --alliances
```

## Troubleshooting

### Common Issues

1. **"No active season found"**
   - Ensure you have an active season in your database
   - Check season configuration

2. **"Battle doesn't meet MMR criteria"**
   - Battle must have 25+ players and 2M+ fame
   - Check battle data quality

3. **"Failed to fetch battle data"**
   - Verify battle ID exists
   - Check API connectivity
   - Ensure battle is not too old

### Debug Mode

For maximum detail, use the `--all` flag:

```bash
yarn mmr:simulate 1268814359 --all
```

This shows:
- Complete guild information
- Detailed participation analysis
- Full factor breakdown
- Anti-farming details
- Alliance relationships

## Integration with Development

### Testing MMR Changes

1. Make changes to MMR calculation logic
2. Run simulation on test battles
3. Compare results before/after changes
4. Iterate until desired behavior is achieved

### Performance Testing

Run simulations on multiple battles to test performance:

```bash
# Test multiple battles
yarn mmr:simulate 1268814359 --all
yarn mmr:simulate 1268814360 --all
yarn mmr:simulate 1268814361 --all
```

### Validation

Use the simulation to validate that:
- Participation criteria work correctly
- Factor weights produce expected results
- Anti-farming system functions properly
- Alliance relationships are handled correctly

## Safety Features

- **No Database Writes**: Simulation never saves data to database
- **Read-Only Operations**: Only reads existing data for analysis
- **Safe to Repeat**: Can run multiple times without side effects
- **Error Handling**: Graceful handling of API failures and missing data

## Performance

- **Fast Execution**: Typically completes in 5-15 seconds
- **Memory Efficient**: Processes data in memory without persistence
- **API Rate Limited**: Respects API rate limits
- **Concurrent Safe**: Can run multiple simulations simultaneously

This tool is essential for understanding, testing, and improving the MMR system while maintaining data integrity and system stability.
