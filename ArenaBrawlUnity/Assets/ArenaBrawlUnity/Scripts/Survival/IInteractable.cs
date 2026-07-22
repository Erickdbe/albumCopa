namespace ArenaBrawl.UnityGame
{
    public interface IInteractable
    {
        string InteractionPrompt { get; }
        bool CanInteract(SurvivalPlayerInteractor interactor);
        void Interact(SurvivalPlayerInteractor interactor);
    }
}
