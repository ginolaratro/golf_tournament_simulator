  Components                                                                                                                          
                                                                                                                                      
  1. GolferScoringModel (Neural Network)                                                                                              
  - Input: 12 features (strokes gained stats, form, course fit, etc.)                                                                 
  - Output: Distribution parameters (μ, σ, skew)                                                                                      
  - Captures both skill level AND volatility per golfer                                                                               
                                                                                                                                      
  2. TournamentSimulator (Monte Carlo)                                                                                                
  - Samples 4 round scores per golfer from their distribution                                                                         
  - Simulates cuts (top 65 after round 2)                                                                                             
  - Runs 10,000+ tournaments to get stable probabilities                                                                              
                                                                                                                                      
  3. BettingEdgeEngine (Expected Value)                                                                                               
  - Compares model probabilities to sportsbook odds                                                                                   
  - Calculates edge: (model_prob × decimal_odds) - 1                                                                                  
  - Uses Kelly Criterion for optimal bet sizing                                                                                       
                                                                                                                                      
  Key Concepts                                                                                                                        
  ┌─────────────────┬──────────────────────────────────────────────────────┐                                                          
  │     Concept     │                    Implementation                    │                                                          
  ├─────────────────┼──────────────────────────────────────────────────────┤                                                          
  │ Volatility      │ σ and skew parameters - some players are boom/bust   │                                                          
  ├─────────────────┼──────────────────────────────────────────────────────┤                                                          
  │ Win Probability │ wins / n_simulations                                 │                                                          
  ├─────────────────┼──────────────────────────────────────────────────────┤                                                          
  │ Edge            │ Model says 10% win prob, odds imply 5% → edge exists │                                                          
  ├─────────────────┼──────────────────────────────────────────────────────┤                                                          
  │ Kelly Sizing    │ Bet proportional to edge, protect bankroll           │                                                          
  └─────────────────┴──────────────────────────────────────────────────────┘        